# storeship — 设计与决策（给接手者）

**是什么**：从 od-mobile 仓库抽出来、准备开源的发布工具包。把一个 Expo / RN iOS App
从本机送进 App Store：归档 / 导出 / 上传 / 版本记录 / What's New / 挂构建 / 提审，
外加商店文案对账、截图与预览视频上传、订阅优惠码、数据报表。
**名字 `storeship` 是占位**（npm 上空着），代码里只在 `package.json` 和 `cli.ts` 的
`NAME` 常量出现；许可证暂填 MIT，两者都还没最终定。

本文只记**代码里问不出来的东西**：为什么这样切、放弃了什么、下一步是什么。
用法看 [README.md](../README.md)。

## 1. 定位：不是「又一个 ASC API 封装」

2026-09-07 调研：包一层 ASC API 的 CLI 已经有一排（Go 的 techinpark/app-store-connect-cli、
Swift 的 tddworks/asc-cli、ittybittyapps/appstoreconnect-cli、Blackjacx/Assist），
fastlane 覆盖同一条链但要整套 Ruby，EAS 走云端且收费、还会静默漏掉 `.gitignore` 里的文件。
**空着的位置是**：Expo/RN 开发者在自己的 Mac 上、零依赖、一条命令走完整条链，
且把踩过的坑做成护栏。差异化只有两件：

1. **整条链而不是一层 API**：`release` 一个命令从 `xcodebuild archive` 到 Waiting for Review。
2. **误导性报错的改写表**（`src/hints.ts`）：每一条都是这个仓库真的往错方向追过的。
   加新条目的判据同样是「真的发生过、而且报错指错了方向」，不收集想象中的坑。

## 2. 分层

```
src/cli.ts          解析 / 分发 / 把错误变成「message + hint」——只有这些
src/commands/*      每个命令：读参数、调下面两层、打印。命令树在这里定义（含 booleans 表）
src/asc/*           纯 ASC 操作，函数拿 client + id，不碰 process.argv / console → 可单测
src/ios/xcode.ts    xcodebuild / altool / expo config / PlistBuddy
src/config.ts       配置文件 + 环境变量 → 完全默认化的 Config（resolveConfig 是纯函数）
src/hints.ts        报错文本 → 真因
skills/*            给 agent 的操作规程（Claude Code SKILL.md 格式），`storeship skill install` 拷进项目
```

**`asc/*` 里的函数是库面**（`src/index.ts` 全部导出），命令层只是薄壳。
这样 agent 和脚本可以不经过 CLI 直接调；测试也只测这一层加纯函数。

## 3. 决策清单

| # | 决定 | 理由 |
|---|------|------|
| 1 | **零运行时依赖，Node ≥ 22.18 直接跑 `.ts`** | 这是宣传点也是简化：没有构建、没有 Ruby、没有 Gemfile。代价见 #2 |
| 2 | **发布到 npm 时必须编译出 `dist/`**（`pnpm build`，`bin` 指向 `dist/cli.js`） | Node **拒绝**剥离 `node_modules` 里 `.ts` 的类型（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。在 pnpm workspace 里能直接跑是因为符号链接 realpath 落在 `node_modules` 外。所以仓库根的 `pnpm storeship` 是 `node packages/storeship/src/cli.ts`，不走 bin |
| 3 | **`erasableSyntaxOnly: true`** | 类型剥离不做任何转换：构造函数参数属性、enum、namespace 在运行期直接是语法错误。tsc 抓到了四处，都是刚写的时候顺手写的参数属性 |
| 4 | **配置：仓库里一份 JSON（或 `.ts`），密钥走 altool 的约定路径** | 标识符（app id / key id / issuer / team）不是密钥，入库；`.p8` 是唯一秘密，放 `~/.appstoreconnect/private_keys/`——altool 自己就在那儿找，用户只需记一个位置。环境变量覆盖是给「临时换一把 Admin key 拉报表」这种场景的 |
| 5 | **相对路径一律从配置文件所在目录解析** | 旧脚本 `listing.ts` 的路径相对 cwd，只能在仓库根跑。命令必须从任何子目录都能用 |
| 6 | **`listing.md` 标准格式**：`## <locale>` + `### <field>`，值为正文或单个围栏块 | 旧解析器绑死了一份特定文档的标题和全角括号。新格式：ASC 属性名当标题、agent 一眼能写；围栏块原样取值让描述里能放 `#` `---`。**缺的字段不动 ASC**，所以可以只管一部分字段 |
| 7 | **`listing` 默认只 diff，`push` 才写** | 六格写错要重新排队审核。这是从旧 `meta --write` 继承的边界 |
| 8 | **`ship` 预检 app.config vs `ios/Info.plist`** | 「忘了 prebuild」的症状是传上去一个旧版本号的包，白搭一个 buildNumber。`expo config --type public --json` 是版本号的真相源 |
| 9 | **导出永远不传 `-authenticationKey*`，上传才传密钥** | 2026-08-30 那一整轮：带了会走云签名，App Manager 的 key 没权限，报错却说「没有发布证书」。`hints.ts` 认这句 |
| 10 | **`ExportOptions.plist` 由配置生成**，`ios.exportOptions` 可追加 | 旧的是手写文件、teamID 硬编码。生成之后 teamID 只在一处 |
| 11 | **`attach --wait` 内建轮询**，默认 30 分钟 | 取代 runbook 里 `until … | grep -q 已挂上` 那句 shell |
| 12 | **`cancel` 必须 `--yes`**，不带只打印后果 | 撤回单向、排队位置作废、能否重提到那一刻才知道（ICP 那次）。不做 `--probe`：submit 本身失败不改状态，先 submit 再决定撤不撤，这条写进 skill 而不是代码 |
| 13 | **`release` 先打印计划再问 `go?`**，非 TTY 要 `--yes` | 它会上传、会提审，agent 跑要显式承担 |
| 14 | **不做的事**：不改版本号、不验 UI、不自动 cancel | 版本号是判断；UI 验证耦合进发布链的两个坏处写在 od-mobile 的 release-runbook.md；cancel 见 #12 |
| 15 | **What's New 走 `<dir>/<版本>/<locale>.txt`**，也接受 `--file locale=path` | 旧命令按 zh/en 位置传两个文件，locale 写死。目录约定让 agent 起草、人过目、命令读取三步分开 |
| 16 | **定时发布的时刻可配置**（`release.scheduledTime`），默认 `00:00:00Z` | 旧代码写死 `T08:00:00-07:00`（= 美西早八点）。od-mobile 的配置里保留了这个值 |
| 17 | **`--json` 全命令支持**，进度走 stderr | agent 不刮屏幕；`Out.emit` 收数据、`finish` 一次打出；`note()` 永远到 stderr |
| 18 | **CLI 文案英文，本文与 od-mobile 侧文档中文** | 面向开源受众；od-mobile 的接手者仍按仓库惯例读中文 |
| 19 | **Android / Google Play 明确不在范围** | 仓库里没有任何积累；README 写明只做 iOS 比做一半好 |

## 4. 从 od-mobile 抽出来时改掉的硬编码

盘点见当天的会话，落到代码里的：app id 原来在五个文件各写一份、只有一处认环境变量 →
现在只在 `storeship.config.json`；key/issuer 在 `.ts` 和 `.sh` 各一份 → 一份；
`media-status` 默认版本写死 `1.3.0` → 必填参数；订阅商品 id → `products` 别名表；
locale 对 `zh-Hans`/`en-US` 写死 → `locales` 数组。

**od-mobile 侧对应改动**（2026-09-07）：`tools/asc/*`、`tools/release/*` 已删；
六格文案从 `docs/appstore/store-listing.md` 搬到 `docs/appstore/listing.md`（新格式），
原文只留理由；1.3.1 的 What's New 搬到 `docs/appstore/whats-new/1.3.1/`；
`release-runbook.md` 改成 storeship 的命令。真机验证：只读命令
（`version status` / `builds` / `media status` / `offer list` / `listing diff` / `doctor`）
对真实 ASC 跑过，`listing diff 1.3.1` 逐格相等证明格式转换无损。
**写命令（create / whatsnew / attach / submit / push / upload / ship）只有单测（假 fetch）**，
要等下一次真发版验收——那是拆成独立仓库之前的最后一道门。

## 5. 后续阶段（Ken 2026-09-07 定的范围：发布链打底，截图 / 预览视频 / 小红书视频都要，配 agent skill）

### 5.1 `shots`：商店截图合成 —— **2026-09-07 已落地**

分工照着定的做了：**工具**（`src/shots/*`、`src/sim/*`）管设备档表（含 ASC display type 和
模拟器名 / pt / px）、检查器（纯函数，注入 fs，所有问题一次报完）、Chrome 渲染、联系表、
`shots upload <版本>` 按 display type 找/建槽位只传缺的文件、`sim` 驱动（idb 优先、CGEvent 退路、
a11y 树定位、`ltap` 横屏换算、状态栏 override）。**项目**给内容文件（`Shot[]`，标题按 ASC locale
码分）和模板模块（`{ render(ctx), titleLines, titleMax, snPattern }`）；随包一个中性默认模板。
`shots.localeTags` 让文件名里继续用 `zh` / `en` 短标签，不用改已有截图的名字。
`shots.seed` 是项目脚本的 hook，参数原样透传。

**验收**：od-mobile 的 `design.ts` 只改签名搬成模板、`content.ts` 只改标题的键，用新工具重渲
28 张，与 2026-08 提交的产物**逐字节相同**（Chrome 同机渲染是确定的，HTML 一字未变）。
设计约束（unit 只缩字号、版式按设备重排、走针跨整套推进、2.3.3、写标题三条）在
`skills/storeship-shots/SKILL.md`，不在代码里。

⚠️ 没做的：`sim` 的 CGEvent 退路只是照 `sim.py` 搬的，这台机器有 idb，**退路没重新验过**。

### 5.2 `preview`：App Store 预览视频 —— **2026-09-07 已落地**

`src/preview/*`：`cut.sh` 的三条 VFR 教训进了 `cut.ts`（每段先渲定长 CFR 中间片；xfade 偏移按
**实际产出**时长算——纯函数 `xfadeChain`；不裁头）；`record.ts` 用 SIGINT 停、认得
「Host recording is already in progress」并提示重启模拟器；`specs.ts` 是 App Preview 的尺寸表
（按 preview type）+ 15–30s + ≤30fps + **帧数与时长不匹配 = VFR 接缝**的判据；
`preview upload` 按 locale × 设备找/建槽位。`ui.py` 的 a11y 定位 2026-09-07 已并进 `sim find/ls`。
ffmpeg 不随包：`~/.local/opt/ffmpeg/ffmpeg`（约定位置，同 idb 的做法）/ 配置 / 环境变量 / PATH。

**验收**：用 8 月的四段原始录屏真跑 `cut`：四段请求 8/7/7/6.5s，VFR 源实际给 8.00/5.93/5.93/5.47s，
成片 23.83s、715 帧（= 23.83 × 30，CFR 成立）、1920×886，`check` 通过；已提交的中文成片
（29.77s / 893 帧）和 iPad 成片（1200×1600）也通过；原始 `.mov` 被判出尺寸不对。
**`record` / `stop` / `upload` 没有真跑**（没有要录的内容、不往线上传）。

### 5.3 `reel`：竖版社交视频 —— **2026-09-07 已落地**

`src/reel/*`：`reel.swift` 参数化（canvas / band / crop / fps / rotate 全走参数），`swiftc` 编译一次缓存在
tmp；`card.ts` 负责「带洞的前景」（四块背板由工具生成，模板不许给卡片上底色，PNG 无 alpha 直接报错）；
`pts.swift` + `steadyRuns()` 自动找等间隔连续帧（= 按拍重画的走针），把 t0 和推算 BPM 打出来；
默认模板就是 od-mobile 那套卡片，文案配色从 `copy` 来。**BAND 只剩一份**（内容文件），
卡片和合成器读同一个。

**验收**：`reel card` 出 1080×1440 RGBA；`reel pts` 在 8 月的 seg3 录屏上找出 0.544s 的稳定节奏
（≈110 BPM，正是当时那首布鲁斯的速度）；`reel make` 用 Pro Max 录屏（1320×2868）对 513 的 band.h
当场报「应为 508」；用 508 的临时内容真跑一遍导出成功（1080×1440 mp4）。**没验音频那一支**
（没有对应的离线伴奏 wav）。

### 5.4 skill 的分工原则

**代码做确定性的事并且校验；skill 做流程和判断。** 每个 skill 都要写清「哪些是人的决定」
（版本号、发布日、文案、是否撤回、裁剪框选哪一段），agent 起草、人拍板。
每条命令 `--json`，skill 只读结构、不刮屏幕。

## 6. 拆仓库：2026-09-07 已拆（`git subtree split`，四次提交的历史保留）

| 门 | 状态 |
|---|---|
| 名字 / 许可证 | storeship / MIT，`repository` 指向 github.com/laixian/storeship |
| `npm pack` 装进空目录、从 od-mobile 目录跑 | `version status` / `skill list` / `shots check` 都通过 dist 跑通（决策 #2 成立） |
| README 例子用假 id | 已换 |
| od-mobile 引用方式 | 暂时 `devDependencies: "storeship": "link:../storeship"`（要求旁边仓库已 `pnpm build`）；**发到 npm 后改成 `^0.1.0`** |
| 一次真实发版用 `storeship release` 走完 | **✅ 2026-09-07 od-mobile 1.3.2 走完**（归档 → 导出 → 上传 → 建版本（定时）→ What's New → attach → listing push → submit，全部对真 ASC）。**0.1.0 在真发版里暴露三条，全部收进 0.1.1**：① 预检拿 Info.plist 的 `$(PRODUCT_BUNDLE_IDENTIFIER)` 占位符比 bundle id → 按 pbxproj 解析；② 导出报 `No Accounts`（Xcode 没登 Apple ID）时只能整条重来 → 加 `export <归档>` 和 `release --archive`，hint 单列；③ attach 拿「最新 VALID 构建」，而刚传的构建几分钟内不在列表里，于是把上一版的构建挂了上去、409 读起来像「没处理完」→ 等指定构建号（`--build`，release 默认用刚构建的）。**教训：假 fetch 单测和只读命令实跑都盖不到「时间」这一维**（构建出现要几分钟、账号会过期），这类只有真跑才知道 |
| GitHub 仓库 / npm publish | 未做，等 Ken 拍板 |
