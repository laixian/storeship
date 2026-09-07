# 命令参考

由 `storeship docs --lang zh` 从命令定义生成，不要手改。所有命令都接受全局参数。`<>` 是必填位置参数，`[]` 是可选部分。

## 全局参数
| 参数 | |
|---|---|
| `--json` | stdout 上输出机器可读的 JSON；进度仍走 stderr |
| `--config` | 配置文件；默认从当前目录向上找 storeship.config.* |

## 命令

- [`init`](#init) — 读工程（expo config）和 App Store Connect，生成 storeship.config.json
- [`doctor`](#doctor) — 逐项体检：Node、Xcode、密钥文件与权限、工程、配置，并实际用密钥请求一次
- [`ship`](#ship) — 归档 → 导出 IPA → 上传到 App Store Connect（版本号由你事先改好）
- [`export`](#export) — 把一个已有的 .xcarchive 导出成 IPA（归档成功、导出失败之后从这里接着走）
- [`upload`](#upload) — 用 altool 上传一个已导出的 IPA
- [`release`](#release) — 整条链：ship + 建版本 + What's New + 等构建挂上 + 提审
- [`products`](#products) — 订阅组 / 订阅 / 定价 / 可售地区 / App 定价，以 products.md 为真相源：查、对账、写入
- [`version`](#version) — App Store 版本记录：状态、创建、What's New、挂构建、提审、撤回
- [`builds`](#builds) — 最近的构建及其处理状态
- [`listing`](#listing) — 商店文案和审核信息以 Markdown 为真相源：查上限、和 ASC 对账、写入
- [`media`](#media) — 截图与预览视频：按语言 × 设备档看状态、上传、建槽位
- [`offer`](#offer) — 订阅优惠码（App Store Connect 网页里没有入口）
- [`device`](#device) — 注册真机（装开发签名的包要用）
- [`apps`](#apps) — 账号里的 App（用来找 app id）
- [`analytics`](#analytics) — Analytics Reports API 与每日销售（要 Admin / Sales 角色的密钥）
- [`shots`](#shots) — App Store 截图：校验、用真实截屏 + 模板渲染、联系表、按设备类型上传
- [`preview`](#preview) — App Preview 视频：录模拟器、把 VFR 录屏剪成规格尺寸的成片、校验、上传
- [`reel`](#reel) — 竖版社交视频：录屏摆进设计好的卡片里，音频按帧时间戳对齐
- [`sim`](#sim) — 驱动开着的模拟器：点 / 拖 / 截图 / 状态栏 / 无障碍树（优先 idb，退路 CGEvent）
- [`skill`](#skill) — 驱动本工具的 agent skill（Claude Code 格式）
- [`docs`](#docs) — 把命令树生成 Markdown 参考（docs/commands.md 就是它出的）

## `init`

读工程（expo config）和 App Store Connect，生成 storeship.config.json

用法: `storeship init [--project DIR] [--key-id ID --issuer-id ID [--key-path P]] [--bundle-id ID] [--force]`

| 参数 | |
|---|---|
| `--project` | Expo / iOS 工程目录（相对配置根目录）；默认就是根目录 |
| `--key-id` | App Store Connect API 密钥 id（和 --issuer-id 一起给时会去查 app id 和语言） |
| `--issuer-id` | App Store Connect issuer id |
| `--key-path` | .p8 路径；默认 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 |
| `--bundle-id` | 要查的 bundle id；默认从 expo config 读 |
| `--force` | 覆盖已有的 storeship.config.json |

## `doctor`

逐项体检：Node、Xcode、密钥文件与权限、工程、配置，并实际用密钥请求一次

用法: `storeship doctor`

## `ship`

归档 → 导出 IPA → 上传到 App Store Connect（版本号由你事先改好）

用法: `storeship ship [--skip-upload] [--force] [--quiet]`

| 参数 | |
|---|---|
| `--skip-upload` | 只归档和导出，打印 IPA 路径留给 `upload` |
| `--force` | app.config 和 ios/ 的版本号不一致（= 没跑 prebuild）时也照样构建 |
| `--quiet` | 不回显 xcodebuild / altool 的输出 |

## `export`

把一个已有的 .xcarchive 导出成 IPA（归档成功、导出失败之后从这里接着走）

用法: `storeship export <path.xcarchive> [--quiet]`

| 参数 | |
|---|---|
| `--quiet` | 不回显 xcodebuild 的输出 |

## `upload`

用 altool 上传一个已导出的 IPA

用法: `storeship upload <file.ipa> [--quiet]`

| 参数 | |
|---|---|
| `--quiet` | 不回显 altool 的输出 |

## `release`

整条链：ship + 建版本 + What's New + 等构建挂上 + 提审

用法: `storeship release <version> [--date YYYY-MM-DD] [--whatsnew DIR] [--archive PATH.xcarchive] [--build N] [--no-ship] [--no-submit] [--yes] [--quiet] [--force] [--timeout MIN]`

| 参数 | |
|---|---|
| `--date` | 定时发布的日期；不给就是审核通过后手动发布 |
| `--whatsnew` | 放 <locale>.txt 的目录；默认 <whatsNew.dir>/<version>，没有就静默跳过 |
| `--archive` | 不再归档，直接导出并上传这个已有的 .xcarchive（导出或上传失败之后从这里接着走） |
| `--build` | 要挂的构建号；默认刚构建的那个，--no-ship 时默认账号里最新的 |
| `--no-ship` | 跳过归档 / 导出 / 上传（构建已经在 App Store Connect 里） |
| `--no-submit` | 挂上构建就停，不提审 |
| `--yes` | 不问确认（不在终端里跑时必须给） |
| `--quiet` | 不回显 xcodebuild / altool 的输出 |
| `--force` | app.config 和 ios/ 的版本号不一致时也照样构建 |
| `--timeout` | 等构建变 VALID 的分钟数；默认 40 |

## `products`

订阅组 / 订阅 / 定价 / 可售地区 / App 定价，以 products.md 为真相源：查、对账、写入

子命令: [`check`](#products-check) · [`status`](#products-status) · [`diff`](#products-diff) · [`push`](#products-push) · [`pricepoints`](#products-pricepoints) · [`delete`](#products-delete)

### `products check`

解析 products.md 并离线检查上限与引用

用法: `storeship products check`

### `products status`

打印 ASC 上现有的组、订阅、状态、基准地区价、地区数、审核截图

用法: `storeship products status`

### `products diff`

products.md 与 ASC 逐项比较，打印要做的每一步；不写

用法: `storeship products diff`

### `products push`

按 diff 的计划写入：建组 / 建订阅 / 语言 / 价格（基准地区等价到全部地区）/ 可售地区 / 审核截图

用法: `storeship products push [--yes]`

| 参数 | |
|---|---|
| `--yes` | 不问确认（不在终端里跑时必须给） |

### `products pricepoints`

列出某订阅在某地区的价格档位（Apple 的档位是离散的，写价格前先看）

用法: `storeship products pricepoints <productId> <TERRITORY> [--near AMOUNT]`

| 参数 | |
|---|---|
| `--near` | 只列这个数附近的档 |

### `products delete`

删掉一个从未提交过的订阅（ASC 只允许删这种）

用法: `storeship products delete <productId> --yes [--with-group]`

| 参数 | |
|---|---|
| `--yes` | 必须给：删了就没了 |
| `--with-group` | 如果这是组里最后一个订阅，把空组也删掉 |

## `version`

App Store 版本记录：状态、创建、What's New、挂构建、提审、撤回

子命令: [`status`](#version-status) · [`create`](#version-create) · [`whatsnew`](#version-whatsnew) · [`attach`](#version-attach) · [`submit`](#version-submit) · [`cancel`](#version-cancel)

### `version status`

列出各版本的状态、发布方式、定时日期

用法: `storeship version status`

### `version create`

建版本记录；给了日期就是定时发布

用法: `storeship version create <version> [--date YYYY-MM-DD]`

| 参数 | |
|---|---|
| `--date` | 定时发布到这一天（时刻取配置的 release.scheduledTime）；不给就是审核通过后手动发布 |

### `version whatsnew`

给每种语言写「此版本的新增内容」

用法: `storeship version whatsnew <version> [--dir DIR | --file <locale>=<path> …] [--dry-run]`

| 参数 | |
|---|---|
| `--dir` | 放各语言 <locale>.txt 的目录；默认 <whatsNew.dir>/<version> |
| `--file` | 单独指定某语言的文件，可重复：--file en-US=notes/en.txt |
| `--dry-run` | 只打印要写的内容，不写 |

### `version attach`

把构建挂到版本上（要 VALID）；--wait 等它变 VALID

用法: `storeship version attach <version> [--build N] [--wait] [--timeout MIN]`

| 参数 | |
|---|---|
| `--build` | 要挂的构建号（CFBundleVersion）；默认账号里最新的那个 |
| `--wait` | 每 30 秒轮询直到构建变 VALID（给了 --build 就是等它出现并变 VALID），而不是直接失败 |
| `--timeout` | --wait 最多等的分钟数；默认 30 |

### `version submit`

提交审核

用法: `storeship version submit <version>`

### `version cancel`

撤回在审的提交单（单向：排队位置作废）

用法: `storeship version cancel --yes`

| 参数 | |
|---|---|
| `--yes` | 必须给：撤回是单向的，排队位置当场作废 |

## `builds`

最近的构建及其处理状态

用法: `storeship builds`

## `listing`

商店文案和审核信息以 Markdown 为真相源：查上限、和 ASC 对账、写入

子命令: [`check`](#listing-check) · [`diff`](#listing-diff) · [`push`](#listing-push)

### `listing check`

解析文案文件并检查字符上限（离线）

用法: `storeship listing check`

### `listing diff`

文案文件与 ASC 上某版本的现值逐格比较，不写

用法: `storeship listing diff <version>`

### `listing push`

把有差异的字段写进 ASC（名称 / 副标题在 appInfo 上，其余字段和审核信息在版本上）

用法: `storeship listing push <version>`

## `media`

截图与预览视频：按语言 × 设备档看状态、上传、建槽位

子命令: [`status`](#media-status) · [`upload`](#media-upload) · [`list`](#media-list) · [`mkset`](#media-mkset) · [`delete`](#media-delete)

### `media status`

每语言每设备档有几张截图、几条预览（以及 set id）

用法: `storeship media status <version>`

### `media upload`

把文件传进一个 set（顺序 = 展示顺序）

用法: `storeship media upload <screenshot|preview> <setId> <file> [file …]`

### `media list`

某个 set 里的条目及其投递状态

用法: `storeship media list <screenshot|preview> <setId>`

### `media mkset`

给某语言建一个空槽位（每种设备类型传第一次之前要建）

用法: `storeship media mkset <screenshot|preview> <localizationId> <displayType>   e.g. preview <locId> IPHONE_67`

### `media delete`

按 id 删一张截图 / 一条预览

用法: `storeship media delete <screenshot|preview> <id>`

## `offer`

订阅优惠码（App Store Connect 网页里没有入口）

子命令: [`list`](#offer-list) · [`new`](#offer-new) · [`csv`](#offer-csv) · [`off`](#offer-off)

### `offer list`

每个已配置商品的 offer 和码批次

用法: `storeship offer list [--product ALIAS|ID]`

| 参数 | |
|---|---|
| `--product` | 只看一个商品（配置里的别名或订阅 id）；默认全部 |

### `offer new`

建一个免费 offer、发一批一次性码、下载 CSV

用法: `storeship offer new --name NAME [--product P] [--duration ONE_YEAR] [--periods 1] [--codes 500] [--expires YYYY-MM-DD] [--eligibility NEW,EXISTING] [--renew] [--out FILE]`

| 参数 | |
|---|---|
| `--name` | offer 名称，同一商品下必须唯一 |
| `--product` | 配置里的别名或订阅 id；默认第一个已配置商品 |
| `--duration` | 免费期的单位：THREE_DAYS / ONE_WEEK / TWO_WEEKS / ONE_MONTH / TWO_MONTHS / THREE_MONTHS / SIX_MONTHS / ONE_YEAR；默认 ONE_YEAR |
| `--periods` | 几个单位；默认 1 |
| `--codes` | 发多少个一次性码；默认 500 |
| `--expires` | 码能兑换的最后一天（YYYY-MM-DD，最多约 6 个月）；默认今天 + 175 天 |
| `--eligibility` | NEW / EXISTING / EXPIRED，逗号分隔；默认 NEW |
| `--renew` | 免费期结束后按标准价自动续订（Apple 的默认值；本工具默认关，而且事后改不了） |
| `--out` | CSV 路径；默认 offer-codes-<name>.csv |

### `offer csv`

重新下载某一批次的 CSV

用法: `storeship offer csv --batch ID [--out FILE]`

| 参数 | |
|---|---|
| `--batch` | `offer list` 里的批次 id |
| `--out` | CSV 路径；默认 offer-codes-<batch>.csv |

### `offer off`

停用一个 offer 连同它所有批次（已发的码当场作废）

用法: `storeship offer off --offer ID`

| 参数 | |
|---|---|
| `--offer` | `offer list` 里的 offer id |

## `device`

注册真机（装开发签名的包要用）

用法: `storeship device add <name> <udid>`

子命令: [`add`](#device-add)

### `device add`

注册一台设备

用法: `storeship device add <name> <udid>`

## `apps`

账号里的 App（用来找 app id）

用法: `storeship apps`

## `analytics`

Analytics Reports API 与每日销售（要 Admin / Sales 角色的密钥）

子命令: [`request`](#analytics-request) · [`list`](#analytics-list) · [`fetch`](#analytics-fetch) · [`sales`](#analytics-sales)

### `analytics request`

向 Apple 申请一份报表快照（数据隔天出）

用法: `storeship analytics request [--access ONE_TIME_SNAPSHOT|ONGOING]`

| 参数 | |
|---|---|
| `--access` | ONE_TIME_SNAPSHOT（默认）或 ONGOING |

### `analytics list`

已申请的报表及各自有几份实例

用法: `storeship analytics list`

### `analytics fetch`

下载某报表最新一份实例，打成表

用法: `storeship analytics fetch "<report name>" [--granularity DAILY|WEEKLY|MONTHLY]`

| 参数 | |
|---|---|
| `--granularity` | DAILY（默认）/ WEEKLY / MONTHLY |

### `analytics sales`

某 vendor number 的当日销售汇总

用法: `storeship analytics sales <vendorNumber> [YYYY-MM-DD]`

## `shots`

App Store 截图：校验、用真实截屏 + 模板渲染、联系表、按设备类型上传

子命令: [`check`](#shots-check) · [`render`](#shots-render) · [`upload`](#shots-upload) · [`seed`](#shots-seed)

### `shots check`

校验内容、源图、裁剪，每个设备档的问题一次报完

用法: `storeship shots check [--device a,b] [--locale x,y]`

| 参数 | |
|---|---|
| `--device` | 设备档 id，逗号分隔；默认内容里排了版的全部设备档（或 shots.devices） |
| `--locale` | locale，逗号分隔；默认配置里的 |

### `shots render`

渲染整套（先校验）；--sheet 顺带出每个设备档 × 语言的联系表

用法: `storeship shots render [--device a,b] [--locale x,y] [--only 1,2] [--sheet]`

| 参数 | |
|---|---|
| `--device` | 设备档 id，逗号分隔 |
| `--locale` | locale，逗号分隔 |
| `--only` | 只重出这几张（序号，逗号分隔） |
| `--sheet` | 同时在临时目录里出一张联系表 |

### `shots upload`

把渲好的截图按 display type 传进 App Store Connect（默认只传缺的）

用法: `storeship shots upload <version> [--device a,b] [--locale x,y] [--replace] [--dry-run]`

| 参数 | |
|---|---|
| `--device` | 设备档 id，逗号分隔 |
| `--locale` | locale，逗号分隔 |
| `--replace` | 先删光那个 set 里的截图 |
| `--dry-run` | 只打印计划，不动任何东西 |

### `shots seed`

对模拟器跑项目自己的种演示数据脚本（参数原样透传）

用法: `storeship shots seed [-- args…]`

## `preview`

App Preview 视频：录模拟器、把 VFR 录屏剪成规格尺寸的成片、校验、上传

子命令: [`record`](#preview-record) · [`stop`](#preview-stop) · [`cut`](#preview-cut) · [`check`](#preview-check) · [`upload`](#preview-upload)

### `preview record`

开始录开着的模拟器（用 `preview stop` 停；绝不要杀进程）

用法: `storeship preview record <out.mov> [--device id | --udid U]`

| 参数 | |
|---|---|
| `--device` | 设备档 id；用它的模拟器名选开着的那台 |
| `--udid` | 改用 UDID 指定 |

### `preview stop`

干净地停止录制（SIGINT），不把会话泄漏在 CoreSimulator 里

用法: `storeship preview stop`

### `preview cut`

多段 → 定长 CFR 中间片 → 叠化 → 淡入淡出（+ 配乐），尺寸按设备档取预览规格

用法: `storeship preview cut <out.mp4> <file:start:dur[:p]>… [--device id | --size WxH] [--portrait] [--music f.wav] [--fps 30] [--xfade 0.5]`

| 参数 | |
|---|---|
| `--device` | 设备档 id → 它的 App Preview 尺寸（iPhone 横、iPad 竖） |
| `--size` | 不用 --device，直接给画布 WxH |
| `--portrait` | 配合 --device：用竖版尺寸 |
| `--music` | 垫在片子下面的音频，淡入 1 秒 / 淡出 1.5 秒，按片长截断 |
| `--fps` | 成片的恒定帧率；默认 30 |
| `--xfade` | 段与段之间叠化的秒数；默认 0.5 |

### `preview check`

按 App Preview 规格查尺寸 / 时长 / 帧率 / 帧数

用法: `storeship preview check <file> [--device id]`

| 参数 | |
|---|---|
| `--device` | 按这个设备档的预览类型查；不给则任一 App Preview 尺寸都算过 |

### `preview upload`

把预览传进某语言 × 设备档的槽位（没有就建）

用法: `storeship preview upload <version> <file.mp4> --device id --locale L [--replace]`

| 参数 | |
|---|---|
| `--device` | 设备档 id → 预览类型 / 槽位 |
| `--locale` | ASC locale 码 |
| `--replace` | 先删掉槽位里已有的预览 |

## `reel`

竖版社交视频：录屏摆进设计好的卡片里，音频按帧时间戳对齐

子命令: [`card`](#reel-card) · [`make`](#reel-make) · [`pts`](#reel-pts)

### `reel card`

把卡片层（视频处是透明洞）渲成 PNG

用法: `storeship reel card <out.png>`

### `reel make`

录屏（+ 音频）→ mp4；每次现渲卡片

用法: `storeship reel make <recording.mov> <out.mp4> [--start s] [--duration s] [--audio f.wav --audio-t0 s] [--card card.png]`

| 参数 | |
|---|---|
| `--start` | 从录屏的第几秒开始；默认 0 |
| `--duration` | 取几秒；默认到结尾 |
| `--audio` | 垫在画面下面的音频文件 |
| `--audio-t0` | 音频的 t=0 落在录屏时间轴的第几秒；由 `reel pts` 给 |
| `--card` | 用这张卡片 PNG，不现渲 |

### `reel pts`

录屏每帧的时间戳，以及等间隔连续帧那几段（其中第一帧就是音频 t=0 该放的位置）

用法: `storeship reel pts <recording.mov> [--all]`

| 参数 | |
|---|---|
| `--all` | 逐帧打印，不只打印等间隔段 |

## `sim`

驱动开着的模拟器：点 / 拖 / 截图 / 状态栏 / 无障碍树（优先 idb，退路 CGEvent）

用法: `storeship sim <which|tap|ltap|drag|shot|statusbar|ls|find|text> … [--profile iphone69] [--udid U]`

| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

子命令: [`which`](#sim-which) · [`tap`](#sim-tap) · [`ltap`](#sim-ltap) · [`drag`](#sim-drag) · [`shot`](#sim-shot) · [`statusbar`](#sim-statusbar) · [`ls`](#sim-ls) · [`find`](#sim-find) · [`text`](#sim-text)

### `sim which`

当前走哪条输入通道、目标是哪台模拟器

用法: `storeship sim which`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim tap`

按设备逻辑点（竖屏）点一下

用法: `storeship sim tap <x> <y>`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim ltap`

按转正后（横屏）截图上量到的像素点一下

用法: `storeship sim ltap <x> <y>`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim drag`

在两个设备点之间拖

用法: `storeship sim drag <x1> <y1> <x2> <y2>`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim shot`

截图；横屏页给 270

用法: `storeship sim shot <out.png> [rotate]`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim statusbar`

把状态栏改成 9:41 / 满电 / 满格

用法: `storeship sim statusbar [--time 9:41]`

| 参数 | |
|---|---|
| `--time` | 时钟文字；默认 9:41 |

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim ls`

无障碍元素列表（要 idb）；可给子串过滤

用法: `storeship sim ls [pattern]`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim find`

点第 n 个标签含该文字的元素（要 idb）

用法: `storeship sim find <label> [nth]`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

### `sim text`

往当前焦点输入文字（要 idb）

用法: `storeship sim text <string>`

参数 (继承自 `sim`):
| 参数 | |
|---|---|
| `--profile` | 设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台 |
| `--udid` | 改用 UDID 指定模拟器 |

## `skill`

驱动本工具的 agent skill（Claude Code 格式）

子命令: [`list`](#skill-list) · [`install`](#skill-install)

### `skill list`

随包的 skill

用法: `storeship skill list`

### `skill install`

把 skill 拷进项目（默认 .claude/skills）

用法: `storeship skill install [--to DIR] [--only NAME]`

| 参数 | |
|---|---|
| `--to` | 目标目录；默认 <配置根目录>/.claude/skills |
| `--only` | 只装这一个 |

## `docs`

把命令树生成 Markdown 参考（docs/commands.md 就是它出的）

用法: `storeship docs [--lang en|zh] [--check FILE]`

| 参数 | |
|---|---|
| `--lang` | en（默认）或 zh |
| `--check` | 和这个文件比较，不同则退出 1（CI 用） |
