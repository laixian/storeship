# 给 agent 用的 storeship

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

这一篇是写给「要把 agent 接到 storeship 上」的人的。agent 本身不需要读它：下面所有东西在运行时都能从 `storeship spec --json`、`storeship state --json` 和任意一条命令的 `error` 对象里拿到。这也正是整个工具遵循的那一条规则——

> **agent 在运行时需要的一切，都必须能从一条它能跑的命令里拿到，而不是从一篇它必须提前读过的文档里拿。**

Markdown 是给「在决定要不要用、怎么用」的人看的；agent 读的是协议。

## 只要记住两条命令

```bash
storeship state --json     # 这次发布走到哪了，下一步该跑什么
storeship spec  --json     # 全部命令、各自的影响面、退出码表、错误码表
```

`state` 是那个循环条件。它会读配置、读磁盘上的工程（跑 `expo config`，所以能抓到「忘了 prebuild」）、读 App Store Connect 上的版本和构建、把文案文件和线上现值对一遍，然后给出一个 `stage` 和一份 `next`。一个刚崩过、隔了一天被唤醒、或者带着全新上下文窗口的 agent，跑这一条就知道该干什么。

```json
{
  "stage": "build-attached",
  "local": { "version": "1.4.0", "build": "42", "problems": [] },
  "version": { "version": "1.4.0", "state": "PREPARE_FOR_SUBMISSION", "build": { "version": "42" } },
  "clean": { "listing": false, "review": true, "whatsNew": true, "products": null },
  "differing": ["listing: zh-Hans/description"],
  "blockers": [],
  "next": [{ "command": "storeship listing diff 1.4.0", "why": "…", "impact": "read" }]
}
```

`stage` 的取值：`no-config`、`not-configured`、`no-version`、`no-build`、`build-processing`、`build-ready`、`build-attached`、`submitted`、`rejected`、`approved`、`live`。`--offline` 跳过 App Store Connect；`--deep` 顺带对 `products.md`，代价是请求多不少。

`spec` 是整棵命令树，每条命令带 `impact`（`read` / `write` / `irreversible`）、`needs`（credentials、xcode、chrome、ffmpeg、idb、simulator）、`humanDecisions`（哪些决定是人的），每个 flag 标了 `boolean` 还是 `value`。`storeship <命令> --help --json` 返回的是同一个对象的单条版本。

## 信封

<!-- storeship:protocol -->
每条命令都接受 `--json`，回的都是同一个信封：

```json
{ "ok": true, "command": "version attach", "data": {}, "changed": [], "warnings": [], "next": [{ "command": "…", "why": "…", "impact": "write" }] }
{ "ok": false, "error": { "code": "BUILD_NOT_PROCESSED", "message": "…", "hint": "…", "retry": "after-wait", "humanAction": null } }
```

`ok` 说的是命令跑没跑成，不是答案是不是「是」。答案由退出码说：

| 退出码 | 含义 | 该怎么做 |
|---|---|---|
| 0 | 命令做了它说的那件事 | 继续 |
| 1 | 命令失败了 | 看 error.code 和 error.retry；retry 是 never 就别重来 |
| 2 | 命令行写错了 | 改命令，绝不要原样重试 |
| 3 | 跑成了，但答案是否定的：被拒、超限、过期、有差异 | 按数据分支——这是结果，不是故障 |
| 4 | 还没结论：还在处理、还在审、还在构建 | 等一会儿再问；答案会自己变 |
| 5 | 只有人能往下走：图形界面操作、密钥，或不可撤销的一步 | 停下来，把 error.humanAction 原话告诉人 |
| 130 | 确认那一步，人回答了否 | 停 |

**认 `error.code`，不要认 message。** `retry: "never"` 意思是原样再跑一次结果一样。
读 `next`——那是这个工具自己会做的下一步，而且里面永远不会有不可撤销的命令。
<!-- /storeship:protocol -->

成功的信封里还有两个字段：

- `changed`——这一次改了什么：`{ kind, target, what, detail }`。加了 `--dry-run` 就是「本来会改什么」，同时带上 `dryRun: true`。两种情况形状完全一样，所以「先把计划给人看，再真跑」不需要写第二个解析器。
- `warnings`——真实、值得知道，但不足以中止。

两个全局 flag 决定 `data` 的粒度：`--raw` 在默认给精简版的地方给完整原始数据（`listing diff` 默认只给字段名和字数，不是每种语言四千字的描述；`analytics fetch` 默认只给前二十行），`--fields a,b` 只保留这几个顶层键。

## 退出码就是契约

把 3、4、5 从「非零」里拆出来，是因为它们要求的动作完全不同，而散文没法用来分支：

- **3 —— 否。** 命令跑成了，答案是否定的：审核被拒、文案有差异、校验发现问题、`doctor` 查出缺东西。别当成崩溃，也别重试。
- **4 —— 未决。** 还没结论：构建还在处理、审核还没定。答案会自己变，等一会儿再问就是了。`version watch` 和 `version attach` 用的就是它。
- **5 —— 得人来。** Xcode 没登 Apple ID、`.p8` 压根没下载过、不可撤销的命令没给 `--yes`。`error.humanAction` 是写来原话转告人的。重试没有任何意义。

## 错误码

Apple 的报错指错方向的次数，多到「把它翻译过来」成了这个工具存在的两个理由之一。翻译结果带一个码，**要分支就分支这个码**：

<!-- storeship:errors -->
| 错误码 | 退出码 | 能否重试 | 它到底是什么 |
|---|---|---|---|
| `UNKNOWN` | 1 | never | 本工具没认出来的错误；message 是原文 |
| `USAGE` | 2 | never | 参数或 flag 写错了 |
| `CONFIG` | 2 | never | 配置文件、或它该有的某个标识符，缺了 |
| `NEEDS_HUMAN` | 5 | never | 需要一次确认、一个密钥，或一个没有任何 flag 能替代的图形界面操作 |
| `ABORTED` | 130 | never | 人回答了否 |
| `CHECK_FAILED` | 3 | never | 离线校验发现问题；什么都没写 |
| `DIFFERS` | 3 | never | 文件和 App Store Connect 对不上；什么都没写 |
| `PREFLIGHT` | 1 | never | 磁盘上的工程不是你要发的那个（prebuild、版本号、bundle id） |
| `NOT_FOUND` | 1 | never | App Store Connect 上没有这个对象 |
| `TIMEOUT` | 4 | after-wait | 等到超时放弃了；等的那件事可能仍会发生 |
| `MISSING_TOOL` | 1 | never | 这条命令要用的外部东西不在（Chrome、ffmpeg、idb、Xcode、开着的模拟器） |
| `PENDING` | 4 | after-wait | 东西在，但还没就绪；过一会儿再问答案就不一样了 |
| `API` | 1 | never | App Store Connect 拒绝了，原因只在 Apple 的报文里 |
| `AUTH` | 1 | never | Apple 不认这把密钥 |
| `KEY_ROLE` | 1 | never | 这把密钥的角色不够调这个接口 |
| `KEY_MISSING` | 5 | never | .p8 不在该在的位置，而它只能下载一次 |
| `ALTOOL_KEY_NOT_FOUND` | 1 | never | altool 只在它自己那四个目录里找 .p8，一个都没找到 |
| `BUILD_NOT_PROCESSED` | 4 | after-wait | 构建还不是 VALID，或者还没出现在列表里 |
| `VERSION_NOT_EDITABLE` | 1 | never | 这个版本在当前状态下是只读的 |
| `XCODE_NO_ACCOUNT` | 5 | never | 👤 Xcode 没登 Apple ID，导出拿不到证书 |
| `CLOUD_SIGNING` | 1 | never | xcodebuild 走了云签名；那句报错指的是错的方向 |
| `ICP_MISMATCH` | 5 | never | 👤 中国大陆 ICP 备案主体对不上，只能在 API 之外解决 |
| `PRICING_INVALID` | 1 | never | 价格点、或它背后的可售地区，对这个订阅不成立 |
| `ATTRIBUTE_IMMUTABLE` | 1 | never | 这个属性只能在创建对象时设 |
| `NODE_TS_STRIPPING` | 1 | never | Node 拒绝跑 node_modules 里的 .ts |

👤 = 只有人能解决；`error.humanAction` 就是要转告他们的话。
<!-- /storeship:errors -->

`error.retry` 说该怎么办：`now`（偶发）、`after-wait`（要等外面的世界先变）、`never`（再跑一次结果一模一样）。

## 不可撤销的命令

`version cancel`、`products delete`、`offer off`、`media delete` 在 spec 里标成 `irreversible`。不给 `--yes`，CLI 就拒绝执行——是 CLI 拒绝，不是命令自己拒绝，所以新加的命令漏不掉这条；而且 `state` 的 `next` 里永远不会出现它们。`--yes` 的含义是「有人接受了那个具体后果」，而那个后果就写在拒绝时的 `error.humanAction` 里：

```
$ storeship version cancel --json
{ "ok": false, "error": { "code": "NEEDS_HUMAN", "message": "cancel is irreversible and needs --yes",
  "humanAction": "cancelling forfeits the review queue position, and whether a re-submit is accepted is only known at re-submit time…" } }
```

只是「会写」的命令（`listing push`、`products push`、`release`）走的是 `--dry-run`：同一份改动集，什么都不动。

没人能回答确认的时候，设 `STORESHIP_NON_INTERACTIVE=1`。这样确认会直接以 `NEEDS_HUMAN` + 退出码 5 失败，而不是卡在一个永远不会有人回答的终端上。

## 权限

`release` 一条命令里包着 `xcodebuild`、一次 `altool` 上传和好几次 App Store Connect 写入，权限分类器常常拒掉这一整条，而每一步单看都会放行。`storeship init` 会把规则写进 `.claude/settings.local.json`（不想要就 `--no-permissions`）：

```json
{ "permissions": { "allow": ["Bash(storeship *)", "Bash(npx storeship *)", "Bash(pnpm storeship *)"] } }
```

如果发版那一半还是被拒，就拆成两条跑——先 `storeship ship`，再 `storeship release <版本> --no-ship`——构建那一半被拒不会连带把 App Store Connect 那一半也拖死。

## Skill

`storeship init` 同时会把五个 Claude Code skill 拷进 `.claude/skills/`（不想要就 `--no-skills`；单独装用 `storeship skill install`）。skill 里放的是**流程和判断**——哪些决定是人的、被拒之后怎么办、标题怎么写——而里面的**事实**（这套协议、错误码表）是生成块，它提到的每一条命令都会被检查是否真的存在：

```bash
storeship skill check --dir .claude/skills   # 这份副本过期了吗？过期退出码 3
storeship skill install                      # 升级 storeship 之后重新装一遍
```

`storeship doctor` 会把过期的副本报成 `agent skills (optional)` 一项。

## 明确不做的事

- **不做 MCP server。** 二十多条命令会变成每个上下文窗口里二十多份 tool schema，而换不来任何「CLI + `--json`」给不了的能力。真要做，三个 tool 就够：`spec`、`state`、`run`。
- **不替人做判断。** 这个工具不会定版本号、不会写 What's New、不会定价、不会撤回提审。这些在 spec 里都标成 `humanDecisions`，让 agent 能看见边界，而不是靠猜。
- **发布链上不验界面。** 一个会因为截图比对失败而卡住的发布命令，下次没人敢用。`shots` 和 `preview` 是分开的。

## 库接口

CLI 调用的所有东西都从包里导出，包括契约本身——`EXIT`、`CODES`、`fullSpec`、`HINTS`——所以一个包装层可以不通过 shell 就说同一套协议。见[库接口](../api.md)。
