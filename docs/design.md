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
| 20 | **审核信息（备注 / 联系人 / 演示账号）是 `listing.md` 的 `## review` 一节**，走同一套 diff / push；演示密码只从 `ASC_DEMO_PASSWORD` 来 | 2026-09-08 X 上一位用户的反馈：「到等待审核从来不是难点，难的是之后 Apple 要的那些」。ASC API 有 `appStoreReviewDetails`（每版一条，新版本自动带上一版的），正好和文案即代码同一个形状。od-mobile 迁移时当场抓到文档和 ASC 已分叉（「智能扒谱」vs「分轨练习」）。密码 API 写了不回读，没法 diff，所以「设了就每次写」比「猜要不要写」诚实；对账时去掉备注尾部换行——ASC 网页编辑器会留一个 |

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

## 7. 产品即代码（0.2）：订阅组 / 订阅 / 定价 / 可售地区 / App 定价

Ken 2026-09-08 问：「能不能在 ASC 从 0 建 App，以及订阅创建和价格管理？」

### 7.1 边界：为什么不做「建 App 向导」

ASC API **没有** `POST /v1/apps`——App 记录（名称、bundle id、SKU、主要语言）只能在网页上建，
这一步永远是手点的，五分钟。API 能做的是它前面的 Bundle ID（`bundleIds` / `bundleIdCapabilities`），
但 Expo prebuild + Xcode 自动签名会在第一次归档时自己注册，工具再做一遍只会撞 409。
所以「从 0」的顺序固定为：**网页建 App 记录 → `storeship init` → `products push` → `listing push` →
`shots upload` → `release`**。向导做一半没意义，做「产品即代码」有意义：订阅和定价是每个付费 App
都要反复碰、网页上又最容易点错的地方，而且形状和 `listing.md` 一模一样。

### 7.2 数据形状（2026-09-08 对 od-mobile 的月付 / 年付实测）

| ASC 对象 | 放什么 | 备注 |
|---|---|---|
| `subscriptionGroups` | `referenceName` | 一个 App 可多组；用户同时只持有组内一项 |
| `subscriptionGroupLocalizations` | `name`（≤30）、`customAppName`、`locale` | 组名是用户在订阅管理页看到的 |
| `subscriptions` | `name`（内部参考名）、`productId`、`subscriptionPeriod`（ONE_WEEK…ONE_YEAR）、`groupLevel`、`familySharable`、`reviewNote`（≤4000） | `state`：MISSING_METADATA → READY_TO_SUBMIT → WAITING_FOR_REVIEW → APPROVED |
| `subscriptionLocalizations` | `name`（≤30）、`description`（≤45）、`locale` | 付费墙上显示的 |
| `subscriptionPricePoints` | 每地区约 800 档，`customerPrice` / `proceeds` | 只读；id 里编码了 (订阅, 地区, 档) |
| `subscriptionPricePoints/{id}/equalizations` | **一个基准档在其他 174 个地区的等价档** | 网页上「按基准地区自动生成其他地区价格」就是它 |
| `subscriptionPrices` | 每地区一条，指向一个价格点；`startDate`（null = 现在）、`preserved` | 改价 = 再 POST 一条新的（带 startDate 就是排期） |
| `subscriptionAvailability` | `availableInNewTerritories` + 175 个地区 | 默认全开。⚠️ **漏了它的症状是 sandbox 永远取不到价格且不报错**（od-mobile 2026-08-18），所以新建订阅时 push 一定写它 |
| `subscriptionAppStoreReviewScreenshots` | 一张，md5 在 `sourceFileChecksum` | 和截图同一套 reserve / PUT / commit。⚠️ **这格只认 1242×2208**（od-mobile 2026-08-18：1290×2796 被拒，缩放 + 补边一次过） |
| `appPriceSchedules` | `baseTerritory` + `manualPrices`（指向 `appPricePoints`） | od-mobile 是免费：CHN 基准、价格点 0.0 |
| `appAvailabilities`（v2） | `availableInNewTerritories` + `territoryAvailabilities` | 这些 v2 端点**不接受 `limit`**（400 PARAMETER_ERROR.ILLEGAL） |

### 7.3 文件格式：`products.md`（路径 `catalog.file`，默认 `products.md`；`products` 这个配置键已被 `offer` 的别名表占用）

```markdown
# Products

## app
- price: CHN 0                 # 基准地区 + 价格；0 = 免费
- territories: all             # 或逗号分隔的地区码

## group OverDrive Pro          # 订阅组，值是 referenceName
### en-US
#### name
OverDrive Pro
### zh-Hans
#### name
OverDrive Pro会员

## subscription com.overdrive.odmobile.pro.monthly    # 值是 productId（上架后不可改）
- group: OverDrive Pro
- reference: Pro 月付
- period: ONE_MONTH
- level: 1                     # 组内档位，1 最高
- familySharable: false
- price: USA 3.99              # 基准地区 + 价格；其余地区按 Apple 的等价表
- territories: all
### en-US
#### name
Monthly
#### description
AI transcription, room hosting, PDF export
### zh-Hans
…
### reviewNote
```
【中文】…
```
### reviewScreenshot
docs/appstore/iap/monthly.png
```

规则和 `listing.md` 同一套：`##` 开一个对象（`app` / `group <参考名>` / `subscription <productId>`），
`- key: value` 是它的标量属性，`###` 是语言或长字段，`####` 是语言下的字段，围栏块原样取值。
`products` 里的别名（`products.monthly = 6802366256`）继续给 `offer` 用；这份文件按 productId 认。

### 7.4 决策清单（续）

| # | 决定 | 理由 |
|---|------|------|
| 21 | **Markdown，不是 JSON** | 和 `listing.md` 一个约定，agent 已经会写；描述、审核备注是文本，围栏块比转义友好。标量用 `- key: value`，四级标题只在「语言 → 字段」这一层出现 |
| 22 | **价格 = 基准地区 + 一个数，其余地区走 `equalizations`** | 这正是 ASC 网页「自动生成」的做法；文件里写 175 行地区价没人维护。对账只比基准地区，外加「有价的地区数」；要手工定某几个地区的价，写 `- prices: JPN 600, KOR 4900` 覆盖 |
| 23 | **档位按「不高于目标价的最近一档」选**，并打印选中的档 | Apple 的档位是离散的（USA 0.29 → 0.39 → …），写 3.99 正好有；写 4.00 就得选一个，宁可低不高 |
| 24 | **改价 = POST 新价格，不改旧的**；`- priceStart: YYYY-MM-DD` 排期，不写就立即（对新订户） | 这是 API 的模型，也留下历史。已上架订阅**涨价**会触发 Apple 的用户同意流程，工具只打印提醒，不替人决定 |
| 25 | **只建、只改，不删**（`products push` 没有删除路径）；`products delete <productId> --yes` 单列，且只对**从未提交**过的订阅有效；**删空组要再给 `--with-group`** | 删了就没了；API 本身也只允许删未提交的。这条命令存在是为了本节的验证：建一个测试订阅再收掉。⚠️ 组的删除是**第二次不可逆操作，而 `--yes` 那一句从没提到它**（code review 抓到），所以改成显式 opt-in；空组留着不花钱 |
| 26 | **审核截图按 md5 对账**（`sourceFileChecksum`） | 不然每次 push 都传一遍 |
| 27 | **可售地区默认全开** + `availableInNewTerritories: true` | 和网页默认一致；要缩就写列表 |
| 28 | **提交不在这里**：新订阅随 App 版本一起 `version submit` | Apple 规定首个订阅必须和一个新版本一起提审。⚠️ **待验证**：API 里版本提交是否自动带上 READY_TO_SUBMIT 的订阅，还是要在 reviewSubmissionItems 里挂——只能在下一次真发版时看 |
| 29 | **0.2 不做**：入门 / 促销 / 赢回优惠、非订阅型 IAP、Bundle ID | 优惠码已有 `offer`；其余等有真实需求再做，先把「组 + 订阅 + 定价 + 地区 + 截图」这条主干走通 |
| 30 | **`products status` 只读打印 ASC 现状**（组、订阅、状态、基准地区价、地区数、截图有无） | 和 `version status` 同一个作用：先看再改 |
| 31 | **可售地区先于价格**，价格写入按地区幂等（已在目标档的跳过） | 2026-09-08 写路径实测：新订阅没设 availability 之前，任何 `subscriptionPrices` POST 都是 409，Apple 只说 "An error occurred while processing the pricing information"；设完当场 201。同一句报错的另一个原因是档位不属于这个订阅。`hints.ts` 认这句。价格 POST 的最小形状是 subscription + subscriptionPricePoint 两条关系，不带 territory、不带 preserveCurrentPrice |
| 32 | **列订阅时不 `include=subscriptionAvailability`**，to-one 记录逐个读并容忍 404 | 刚建、没设地区的订阅会让整个列表 404（"no resource of type subscriptionAvailabilities"），读现状的命令就全挂了 |
| 33 | **价格写地区码不写货币**（`USA 3.99`，不是 `USD`） | 我自己第一次就写成 USD；Apple 全部按地区（ISO 3166 alpha-3）。解析器认出常见货币码直接给出对应地区 |

### 7.4b code review 抓到的 11 条（2026-09-08，发 npm 之前修完）

`/code-review` 对 `v0.1.3...HEAD` 跑了一轮，findings 全部成立，**其中六条是「静默做错事」那一类**——
diff 说没变化，实际上该改的没改。都在发 0.2.0 到 npm 之前修掉了，每条配回归单测。

| 症状 | 真因 | 修法 |
|---|---|---|
| `- territories: USA, CHN, JPN` 改成 `USA, GBR, DEU`，diff 说没变化 | 只比地区**个数**，而 `readAscCatalog` 压根没读回地区**清单** | 从关系端点读回真实清单，按**集合**比 |
| `- prices: JPN 600` 改成 `800`，diff 说没变化 | 只比基准地区那一格（`basePrice`） | 一次分页读回**整张价格表**（每地区每一行的金额与生效日），文件里写的每一个金额都要对上 |
| 带 `- priceStart` 的文件每次 push 都重写 175 行 | 幂等判据被 `!s.priceStart` 关掉了 | 判据改成「该地区已有一行 startDate 与目标档都相同」，排期改价同样幂等 |
| App 只在 3 个地区可售，却报 `all 175 territories` | 数的是 `territoryAvailabilities` **记录数**，而不可售的地区也有记录（`available: false`） | 过滤掉 `available: false` |
| 换审核截图失败之后，商品变成**一张截图都没有** | 先删旧的再传新的，而这一格只认 1242×2208、传别的尺寸必失败 | 先传新的、成功后再删旧的；只有 409（ASC 只留一张）才回退到「先删再传」 |
| 组的 `customAppName` 在文件里不写就被清空 | 那一支把「没写」当成「要清空」，与其余字段相反 | 没写 = 不动，与 `description` 一致 |
| 重复的 `## group 同名` 不报错 | 只查了订阅 id 重复 | `check` 一并查 |
| 只写 `- prices:` 不写 `- price:` 时什么都不做 | 整段定价逻辑挂在 `if (s.price)` 下 | `check` 直接报错说明基准价是必须的 |
| 同一个地区可能被 POST 两次 | 等价表 + 覆盖表拼成数组、按下标替换，`territory` 还可能是 undefined | 改成按地区做 Map，顺带只写文件声明的那些地区 |
| `pricepoints --near` 的窗口是按**下标**取的 | 假设 ASC 按价格排好序，实际没有这个保证 | 先按金额排序，先在全表上选档再取窗口 |
| `products delete` 顺手删掉整个组 | `--yes` 只提到订阅 | 见决策 #25 |

⚠️ **方法论**：这一轮的 bug 全部是「读得不够」造成的——只读回一个标量（个数、基准价），
就只能比那个标量，而 diff 的整个价值在于「说没变化就是真没变化」。**对账工具的读路径要读回
足以重建那个对象的全部信息**，宁可多一次分页请求。

## 8. `version watch`：驳回这件事是能被发现的（2026-09-08）

Ken 问「被驳回是不是只能他大半夜自己发现」。**事件能发现，理由不能**——这两件事我一开始混为一谈了。
实测 od-mobile 在审的那一单，API 里有三层信号，而且**它们不一定同时翻**：

| 读什么 | 在审时 | 被驳回时 |
|---|---|---|
| `appStoreVersions.appVersionState` | `WAITING_FOR_REVIEW` → `IN_REVIEW` | `REJECTED` / `METADATA_REJECTED` / `DEVELOPER_REJECTED` |
| `reviewSubmissions.state` | 同上 | `UNRESOLVED_ISSUES` |
| `reviewSubmissionItems.state`（`?include=appStoreVersion` 才对得上版本） | `READY_FOR_REVIEW` | 逐项 `APPROVED` / `REJECTED` |

第三层的价值是**一单里可能同时挂着 App 版本和订阅**，item 级别才说得出是哪一项被拒。

| # | 决定 | 理由 |
|---|------|------|
| 34 | **`version watch <版本>`：轮询到有结论为止，退出码 0 过审 / 3 被拒 / 4 未决**；`--once` 只查一次 | 退出码让调用方（cron、`/loop`、agent）能分支，而不用去刮输出 |
| 35 | **不做 `--on-change` 这类钩子**（Ken 2026-09-08 提的） | 跑这条命令的本来就是 agent，它返回了 agent 直接读输出即可；要唤醒一个不在跟前的 agent，那是 harness（定时任务 / loop）的职责，不是本工具的 |
| 36 | **判据以版本状态为准**，提交单和 item 只在版本还读作 pending 时用来提前判定 | 三层不同时翻；已经 approved 的版本不该被一条过期的提交单记录翻回 rejected |
| 37b | **轮询频率有地板（`--interval` 最低 2 分钟），429 / 5xx 退避而不是当场结束** | Ken 2026-09-08 提醒别把请求打太密。一次轮询最多 3 个 GET（版本、未完成的提交单、那一单的 items），默认 10 分钟 ≈ 每小时 18 个请求，而 Apple 的配额是 3600/小时；即便压到地板的 2 分钟也只有约 90。地板放在**命令层不在库层**，库仍接受任意间隔（单测要跑得快）。⚠️ 退避是必需的：这条命令要在那儿守一天，因为一次 429 就整个退出的守望毫无价值；连续失败 5 次才放弃，401 这种不会自愈的当场抛 |
| 37 | **不做「自动修复并重新提交」** | 理由不在 API 里，不知道原因就改等于猜；猜完自动提交，是拿一个审核周期赌一个猜测，而代价由用户承担。**自动化到「醒来时一切就绪」为止，按下提交的是人** |

### 7.5 验证（2026-09-08 全部做完）

- **读路径 ✅**：od-mobile 的 `products.md` 照现状写（一组两订阅 + 免费 App），`products diff` 为空——15 项全部 `=`。
- **写路径 ✅**：一次性的组 `storeship-test` + 周付 `com.overdrive.odmobile.storeship.test.20260908`（product id 一次性用掉，Apple 不让复用）：
  建组、两种语言、建订阅、两种语言、可售地区 175、USA 0.99 等价到全部地区（CHN 6 覆盖生效、JPN 等价成 150）、
  1242×2208 截图上传 → `status` 显示 READY_TO_SUBMIT → 再 diff 为空 → `products delete --yes` 连组一起收掉。
  中间断了四次（USD 写成 USA、列表 include 404、地区先于价格、Apple 两次 500），每次都是原样重跑接着走——幂等是真的。
- **App 定价**：od-mobile 免费，只验了 diff 为空；改价路径留到有付费 App 时。
- **没验的**：`priceStart` 排期、`prices` 覆盖之外的手工地区列表、`customAppName`、订阅随版本提审（#28）。
  §7.4b 修完之后**重跑了 od-mobile 的 `products diff`，15 项仍然全等**（地区数这次来自真实清单而不是记录数）。
