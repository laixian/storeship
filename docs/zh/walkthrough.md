# 从零到「等待审核」

一个 Expo / React Native iOS App 用 storeship 首次上架的完整路径，按事情必须发生的顺序写。之后每次发版是最后那一小节。

## 0. 先要有的东西

- 一台装了 Xcode 的 Mac，Node ≥ 22.18，你的 App 已经能装到真机上（`npx expo run:ios --device` 能跑通）。
- Apple Developer Program 会员，并且 App Store Connect 里已经建好 **App 记录**（名称、bundle id、SKU、主要语言），要几种语言就在「App 信息 → 可本地化的信息」里加好。付费 App 还要先把协议 / 收款 / 税务走完——这些都没法用脚本做。
- 一把 *App Manager* 角色的 **App Store Connect API 密钥**（用户和访问 → 集成 → App Store Connect API）。`.p8` **只能下载一次**，放到 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`，`chmod 600`。记下 key id 和 issuer id。

## 1. 安装与配置

```bash
npm i -D storeship
npx storeship init --key-id ABC123DEF4 --issuer-id 00000000-0000-0000-0000-000000000000 [--project apps/mobile]
npx storeship doctor
```

`init` 从 `expo config` 读 bundle id 和 team id，向 App Store Connect 查 app id 和已有语言，写出 `storeship.config.json`。`doctor` 把后面每一步要用的东西逐项检查，缺什么说怎么补。配置文件提交进仓库，里面只有标识符。

## 2. 定版本号、生成原生工程

版本号是判断，工具不替你改。改 `app.config.*` 里的 `version`（用户看到的）和 `ios.buildNumber`（每次上传都要递增，同一版本重传也是）。然后：

```bash
npx expo prebuild
```

`ship` 会比对 `app.config` 和 `ios/…/Info.plist`，不一致直接拒绝——这就是「忘了 prebuild」那个坑，在白搭一个构建号之前拦住。

## 3. 商店文案写成文件

写 `store-listing.md`（路径由 `listing.file` 定）：

```markdown
## zh-Hans
### name
示例
### subtitle
一行，30 字以内
### keywords
逗号分隔,不要空格,100 字符
### description
```
最多 4000 字。围栏块里的内容原样取。
```
### promotionalText
最多 170 字；上线之后唯一能随时改的一格。
```

`npx storeship listing check` 离线查上限。名称 / 副标题挂在 App 上，关键词 / 描述 / 促销文本挂在每个版本上，所以要先有版本记录才能 diff 和 push（第 6 步）。

## 4. 截图

支持的每一档设备都要一套（至少 6.9" iPhone；`supportsTablet` 就还要 13" iPad）。截图来自模拟器，摆进画布再加一句标题。

1. 在要截的模拟器上装 **Release** 包（`npx expo run:ios --device "iPhone 17 Pro Max" --configuration Release`）。开发包会露出开发者界面；而 Release 包装上之后 Metro 就不再热更新它，这是正常的。
2. 需要演示数据就用你自己的脚本种进去（挂成 `shots.seed`），重启 App，然后 `npx storeship sim statusbar`（9:41、满电）。
3. 逐屏截到 `shots.src`，文件名 `<prefix>-<localeTag>-<n>-<slug>.png`：`npx storeship sim find "播放"` 按无障碍标签点，`sim tap x y`，`sim shot iphone-zh-1-home.png`（横屏页加 `270`）。切换 App 语言后再来一套。
4. 在 `shots.content` 里描述整套（`Shot[]`：序号、slug、底色、每种语言的标题行、每个设备档的裁剪框）——形状和内置模板见 README，也可以写自己的模板。
5. `npx storeship shots check` 跑到干净，`npx storeship shots render --sheet`，**打开联系表看一眼**：单张都好看，只有排成一行才看得出底色打架、走向断掉。
6. 版本记录建好之后（第 6 步）再传：`npx storeship shots upload <版本>`。按语言 × 设备类型对号入座，只传新文件。

## 5. 预览视频（可选）

```bash
npx storeship preview record seg1.mov --device iphone69   # 用 `storeship sim …` 操作 App
npx storeship preview stop                                # 绝不要杀进程
npx storeship preview cut out.mp4 seg1.mov:0:8:p seg2.mov:1:7 --device iphone69 [--music song.wav]
npx storeship preview check out.mp4 --device iphone69
```

版本建好后上传：`npx storeship preview upload <版本> out.mp4 --device iphone69 --locale zh-Hans`。

## 6. 建版本、写文案、传媒体

```bash
npx storeship version create 1.0.0                     # 定时发布加 --date 2026-10-01
npx storeship listing diff 1.0.0                       # 哪些不一样；不写
npx storeship listing push 1.0.0
npx storeship shots upload 1.0.0
npx storeship preview upload 1.0.0 out.mp4 --device iphone69 --locale zh-Hans
```

What's New 按语言写到 `<whatsNew.dir>/1.0.0/<locale>.txt`（App Store Connect 从第二个版本起才显示这一格，首版有文件也无妨）。

## 7. 构建、上传、挂构建、提审

```bash
npx storeship release 1.0.0 --date 2026-10-01
```

先打印计划问一句，然后：预检 → `xcodebuild archive` → `xcodebuild -exportArchive`（**不带** API 密钥：带了 Xcode 会走云签名，报一句误导性的「没有发布证书」）→ `altool --upload-app`（这一步才带密钥）→ 没有版本记录就建 → 写 What's New → 等构建处理完（通常 5 到 20 分钟）挂上 → 提审。

每一步都幂等。失败了读报错下面那行提示，修完原样重跑。构建是用别的方式传的（Xcode Organizer、CI）就加 `--no-ship`（并用 `--build <N>` 点名）；想停在提审之前加 `--no-submit`，之后再 `npx storeship version submit 1.0.0`。

两个续跑点，最好在用到之前就知道：

- **归档成功、导出失败**（多半是 `No Accounts`：Xcode 里没登 Apple ID，去 Xcode → Settings → Accounts）。登回去之后 `npx storeship release 1.0.0 --date … --archive "<路径>.xcarchive"`，不必重新归档。`doctor` 会提前查账号，正常情况下碰不到。
- **上传刚完就挂构建、报 409**：新构建要几分钟才出现在列表里，工具会等它刚构建的那个号。手工挂要点名：`npx storeship version attach 1.0.0 --build <N> --wait`。

让 agent 替你跑的话，先给它加一次允许规则（见 README →「给 agent」）；不然 `release` 这一整条常被拒，而它的每一步单看都会放行。

## 8. 提审之后

- `npx storeship version status` 看状态，`builds` 看构建。
- 版本在 *等待审核* / *审核中* 时，名称、副标题、关键词、描述、媒体全部只读。**促销文本是唯一随时能改的一格。**
- 要改其余的只能撤回：`npx storeship version cancel --yes`。排队位置当场作废，而且能不能重新提交要到那一刻才知道（账号级校验在提交时才跑）。先提交，非改不可再撤。
- 给了 `--date`，审核通过后到那天自动上线。日期前要留出审核时间。

## 下一次发版

1. 改 `app.config.*` 的 `version` 和 `ios.buildNumber`，`npx expo prebuild`。
2. 写 `<whatsNew.dir>/<版本>/<locale>.txt`。
3. 只重渲变了的截图；`shots upload <版本>` 只传新文件（截图和预览从上一版继承）。
4. `npx storeship release <版本> --date …`。

## 顺手还有

- `offer new --name … --codes 500` 建订阅优惠码并下载 CSV（App Store Connect 网页里没有这个入口）。
- `reel make take.mov out.mp4` 把录屏摆进带文案的卡片，出竖版社交视频。
- `skill install` 把 Claude Code skill 拷进 `.claude/skills/`，agent 就能跑上面所有步骤，判断留给你。
