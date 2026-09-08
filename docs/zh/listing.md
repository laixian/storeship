# 商店文案即代码

六格元数据和审核信息放在一个 Markdown 文件里，先和 App Store Connect 对账，只写有差异的字段。命令：`storeship listing check`、`storeship listing diff`、`storeship listing push`。

[← README](README.md) · [命令参考](commands.md) · [配置参考](config.md) · [给 agent 用](agents.md)

`listing.md` 是六格元数据和审核信息的唯一真相源。`listing diff` 看差异，`listing push` 只写差异。

```markdown
# Store listing

## zh-Hans
### name
我的应用
### subtitle
一句话
### keywords
甲,乙,丙
### description
```
多段文字。围栏块原样取值，所以里面的 `#` 和 `---` 是安全的。
```
### promotionalText
可选。

## en-US
### name
…
```

规则：长得像 locale 码的 `##` 开一门语言，其他 `##` 是散文、忽略；字段标题就是 ASC 的属性名；没写的字段不动 ASC。写之前先查上限（30 / 30 / 100 / 4000 / 170，中文算 1 个字符）。

What's New 放 `<whatsNew.dir>/<版本>/<locale>.txt`，或 `--file en-US=path`。

## 审核信息

「等待审核」之后 App Review 要的那些——审核备注、联系人、演示账号——放在同一份文件的 `## review` 下（每个版本一条记录；ASC 会把上一版的带过来，所以 diff 通常是空的）：

```markdown
## review
### notes
```
无需登录。首页 → 功能谱库 → 任选一首 → 播放。
「本地网络」权限只给可选的多设备模式用……
```
### contactFirstName
Ada
### contactLastName
Lovelace
### contactPhone
+1 555 0100
### contactEmail
ada@example.com
### demoAccountName
reviewer@example.com
### demoAccountRequired
true
```

演示账号的密码永远不进文件：设环境变量 `ASC_DEMO_PASSWORD`，每次 push 都会写（API 不会把它读回来，所以没法 diff）。备注上限 4000 字符，`listing check` 离线就查。
