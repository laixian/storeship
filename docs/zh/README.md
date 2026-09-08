# storeship

在你的 Mac 上，用一条命令把 Expo / React Native iOS App 送进 App Store，坑已经封在工具里——而且整个接口是照着「给 agent 开」设计的。

```bash
npx storeship release 1.4.0 --date 2026-10-01
```

这一条做的事：预检（忘了 `expo prebuild`？）→ `xcodebuild archive` → 导出 IPA → `altool` 上传 → 建 App Store 版本记录（定时发布）→ 给每种语言写 What's New → 等构建处理完挂上 → 提审。每一步都幂等，中途死了原样重跑。

**English**: [README.md](../../README.md) · **文档**：[从零到提审](walkthrough.md) · [给 agent 用](agents.md) · [命令参考](commands.md) · [配置参考](config.md) · [商店文案](listing.md) · [订阅与定价](products.md) · [截图与视频](media.md) · [库接口](../api.md)

## 为什么又一个工具

- **fastlane** 全都能做、还能做更多，代价是 Ruby、Gemfile 和一套要学的 `Fastfile`。
- **EAS** 在云端做、收费，而且会静默漏掉 `.gitignore` 里的文件。
- GitHub 上那些 **App Store Connect CLI** 一个接口一条命令，到 API 为止。

storeship 在中间：**零运行时依赖**（Node ≥ 22.18 直接跑 TypeScript）、一份 JSON 配置、从 `xcodebuild` 到「等待审核」的整条路，外加一张把 Apple 误导性报错翻译成真因的表。它是从一个已上架的 App 里抽出来的，作者为每一条都交过学费。

## 照着「给 agent 开」设计

不是「加了个 `--json`」。agent 需要的那套接口本身就是产品：

```bash
storeship state --json     # 这次发布走到哪了，下一步该跑什么
storeship spec  --json     # 全部命令、各自的影响面、退出码表、错误码表
```

- **只有一种信封**——`{ ok, command, data, changed[], warnings[], next[], error? }`。`ok` 说的是「命令跑没跑成」，答案是不是「是」由退出码说。
- **退出码是契约。** 0 成功 · 2 命令写错 · **3 否**（被拒、有差异、超限）· **4 未决**（还在处理、还在审）· **5 得人来**（图形界面操作、密钥、不可撤销的一步）· 1 失败。
- **稳定的错误码。** 密钥错、密钥被吊销、DER 签名、时钟偏差——Apple 一律回一个光秃秃的 401。storeship 回 `AUTH`，真因在 `hint` 里；另外还有 `XCODE_NO_ACCOUNT`、`BUILD_NOT_PROCESSED`、`VERSION_NOT_EDITABLE`、`CLOUD_SIGNING` 等等，全是「报错指错方向」的那几句。**认码，不要认英文。**
- **影响面是数据，不是 README 里的一句提醒。** 每条命令都声明 `read` / `write` / `irreversible`，以及哪些决定是人的。不可撤销的命令不给 `--yes` 就被 CLI 拒掉，而 `state` 的 `next` 里永远不会出现它们。
- **所有会写的命令都有 `--dry-run`**，给出的改动集和真跑时报的是同一个形状。
- **不会漂的 skill。** `storeship init` 会顺手装好五个 Claude Code skill 和那条权限规则；skill 里的「事实」是从代码生成的，而且 CI 会因为 skill 提到一条不存在的命令而失败。

完整契约和怎么把 agent 接上去：**[给 agent 用](agents.md)**。

## 要求

- macOS + Xcode（`ship` 要）；App Store Connect 那些命令在任何能跑 Node 的地方都行
- Node ≥ 22.18
- 一把 App Store Connect API 密钥（发版 App Manager 角色够用；拉数据要 Admin）

## 安装

```bash
npm i -D storeship            # 装进项目——推荐，版本号钉在 package.json 里
npm i -g storeship            # 或全局
npx storeship@latest doctor   # 或干脆不装
```

npm 包是编译好的产物；TypeScript 源码只在 Git 仓库里。要从源码跑（改工具本身时）：`git clone https://github.com/laixian/storeship && cd storeship && pnpm install && pnpm build && node dist/cli.js …`。

## 配置

```bash
npx storeship init            # 从 expo config + ASC 生成配置，顺带装 agent skill 和权限规则
npx storeship doctor          # 逐项检查，缺什么说怎么补
npx storeship state           # 发布走到哪了，下一步跑什么
```

私钥放 Apple 自己的 `altool` 也会去找的位置：

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8     (chmod 600)
```

key id、issuer id、app id、team id 是标识符不是密钥，放进配置文件。环境变量覆盖文件：`ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_PATH`、`ASC_APP_ID`、`ASC_TEAM_ID`。演示账号密码永远不进文件：`ASC_DEMO_PASSWORD`。

```json
{
  "app": { "id": "1234567890", "bundleId": "com.example.app" },
  "asc": { "keyId": "ABC123DEF4", "issuerId": "00000000-0000-0000-0000-000000000000", "teamId": "TEAM123456" },
  "locales": ["zh-Hans", "en-US"],
  "ios": { "projectDir": "apps/mobile" },
  "listing": { "file": "store/listing.md" },
  "whatsNew": { "dir": "store/whats-new" },
  "release": { "scheduledTime": "08:00:00-07:00" },
  "products": { "yearly": "1234567891" }
}
```

配置里所有相对路径都相对配置文件解析，所以命令在任何子目录里都能跑。`ios.workspace` / `ios.scheme` / `ios.infoPlist` 不写就从 `<projectDir>/ios` 推。`.ts` / `.mjs` 配置文件导出同样的对象也行。每一个键见[配置参考](config.md)。

## 命令

所有命令都支持 `--json`。完整参数见[命令参考](commands.md)，或 `storeship <命令> --help`。

| 命令 | 做什么 |
|---|---|
| `init` | 写配置，装 agent skill 和权限规则 |
| `doctor` | 查 Node、Xcode、密钥文件、权限、工程，并实际用密钥请求一次 |
| `state` | 一次调用说清发布走到哪了、下一步跑什么 |
| `spec` | 机器可读的接口本身：影响面、退出码、错误码 |
| `ship [--skip-upload]` | 预检 → 归档 → 导出 → 上传 |
| `export <归档>`、`upload <ipa>` | 上面某一步失败之后的接着走的点 |
| `release <版本> [--date D] [--dry-run] [--yes]` | 整条链，先打印计划再问一句 |
| `version status \| create \| whatsnew \| attach \| submit \| watch \| cancel` | 版本记录，从建到审核出结论 |
| `builds` | 最近的构建及处理状态 |
| `listing check \| diff \| push` | 商店文案与审核信息，一个 Markdown 文件说了算 → [文档](listing.md) |
| `products check \| status \| diff \| push \| pricepoints \| delete` | 订阅、定价、可售地区 → [文档](products.md) |
| `offer list \| new \| csv \| off` | 订阅优惠码（ASC 网页里没有入口） |
| `media status \| upload \| mkset \| list \| delete` | 截图与预览的槽位 |
| `shots`、`sim`、`preview`、`reel` | 商店截图、模拟器驱动、App Preview、社交视频 → [文档](media.md) |
| `analytics request \| list \| fetch \| sales` | 报表与每日销售 |
| `device add`、`apps` | 注册真机、列账号里的 App |
| `skill list \| install \| check \| sync` | agent skill |

## 它替你记住的坑

| 你看到 | 它告诉你 |
|---|---|
| 导出时 `No signing certificate "iOS Distribution" found` | xcodebuild 走了云签名，因为带了 `-authenticationKey*`。storeship 从不带；Xcode 在导出那一刻自己申请证书。导出不带密钥，上传才带。 |
| `401 NOT_AUTHORIZED` | id 错、密钥被吊销、`.p8` 不配、DER 签名（它签的是裸 R‖S）、或时钟偏差 |
| `The specified pre-release build could not be added` | 构建还在处理，或者挑到了旧构建（新的还没进列表）；用 `--build N --wait` 点名 |
| 写名称 / 副标题 `409` | 撞到锁死的线上 appInfo 了；账号里有两个 |
| `ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH` | 中国大陆备案主体名 ≠ 开发者名；API 改不了 |
| `The API key in use does not allow this request` | 密钥角色不够（拉数据要 Admin） |
| 建优惠码 409 ×175 | 免费 offer 要列地区但不能带价格点；已替你从价格表抄 |
| 截图灰块 | 校验和错；它提交的是 MD5 |
| 归档七分钟之后来一句 `No Accounts` | Xcode 没登账号。`doctor` 事先就报了，而且归档还好好的：用 `--archive` 接着走。 |

每一条在 `src/hints.ts` 里都是一个条目、带一个错误码，而且每一条都真的往错方向追过。

## 它不做的事

- **不替你定版本号。** 改 `app.config`（`version` 和 `ios.buildNumber`）再 `expo prebuild`；`ios/` 和 `app.config` 不一致时 `ship` 拒绝。
- **不验界面。** 截图和预览是独立命令，不在发布链上。
- **不自作主张撤回提审、删订阅、停优惠码。** 这些都要 `--yes`：撤回丢排队位置，优惠码一停已经发出去的码当场作废。
- **不建 App 记录。** API 没这个接口：网页上五分钟，然后 `storeship init`。
- **不做 Android。** 这里没有任何相关积累，只做 iOS 好过两边都做一半。

## 许可证

MIT
