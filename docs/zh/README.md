# storeship

在你的 Mac 上，用一条命令把 Expo / React Native iOS App 送进 App Store，坑已经封在工具里。

```bash
npx storeship release 1.4.0 --date 2026-10-01
```

这一条做的事：预检（忘了 `expo prebuild`？）→ `xcodebuild archive` → 导出 IPA → `altool` 上传 → 建 App Store 版本记录（定时发布）→ 给每种语言写 What's New → 等构建处理完挂上 → 提审。每一步都幂等，中途死了原样重跑。

**English**: [README.md](../../README.md) · 文档：[从零到提审](walkthrough.md) · [命令参考](commands.md) · [配置参考](config.md) · [库接口](../api.md)

## 为什么又一个工具

- **fastlane** 全都能做、还能做更多，代价是 Ruby、Gemfile 和一套要学的 `Fastfile`。
- **EAS** 在云端做、收费，而且会静默漏掉 `.gitignore` 里的文件。
- GitHub 上那些 **App Store Connect CLI** 一个接口一条命令，到 API 为止。

storeship 在中间：**零运行时依赖**（Node ≥ 22.18 直接跑 TypeScript）、一份 JSON 配置、从 `xcodebuild` 到「等待审核」的整条路，外加一张把 Apple 误导性报错翻译成真因的表。它是从一个已上架的 App 里抽出来的，作者为每一条都交过学费。

## 要求

- macOS + Xcode（`ship` 要）；App Store Connect 那些命令在任何能跑 Node 的地方都行
- Node ≥ 22.18
- 一把 App Store Connect API 密钥（发版 App Manager 角色够用；拉数据要 Admin）

## 安装

三种装法，都从 npm 来，别的什么都不用装（Node ≥ 22.18，零运行时依赖）。

```bash
# 装进项目——推荐，版本号钉在 package.json 里
npm i -D storeship            # 或 pnpm add -D storeship
npx storeship --version

# 全局
npm i -g storeship
storeship --version

# 不装，直接用
npx storeship@latest doctor
```

npm 包是编译好的产物；TypeScript 源码只在 Git 仓库里。要从源码跑（改工具本身时）：`git clone https://github.com/laixian/storeship && cd storeship && pnpm install && pnpm build && node dist/cli.js …`。

### 配置

```bash
npx storeship init            # 从 expo config + ASC 生成 storeship.config.json
npx storeship doctor          # 逐项检查，缺什么说怎么补
```

私钥放 Apple 自己的 `altool` 也会去找的位置：

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8     (chmod 600)
```

key id、issuer id、app id、team id 是标识符不是密钥，放进配置文件。环境变量覆盖文件：`ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_PATH`、`ASC_APP_ID`、`ASC_TEAM_ID`。配置的每一个键见[配置参考](config.md)。

### 装 agent skill

包里带四个 Claude Code skill：`storeship-release`、`storeship-shots`、`storeship-preview`、`storeship-reel`，每个是一件事的操作规程，判断留给你。每个项目装一次：

```bash
npx storeship skill list
npx storeship skill install                                   # → .claude/skills/storeship-*/SKILL.md
npx storeship skill install --only storeship-release          # 只装一个
npx storeship skill install --to ~/.claude/skills             # 装到用户级，不按项目
```

Claude Code 下一次会话就能用，之后一句「发 1.4.0，定 10 月 1 日上线」就是完整指令。装进去的是拷贝不是链接，升级包之后要再跑一次 `skill install`。让 agent 跑发版不被反复确认要加的那一条权限规则见下面「给 agent」。

## 命令

所有命令都支持 `--json`（进度仍走 stderr）。完整参数见[命令参考](commands.md)，或 `storeship <命令> --help`。

| 命令 | 做什么 |
|---|---|
| `init` | 从 `expo config` 和 App Store Connect 写配置 |
| `doctor` | 查 Node、Xcode、密钥文件、权限、工程，并实际用密钥请求一次 |
| `ship [--skip-upload]` | 预检 → 归档 → 导出 → 上传 |
| `upload <ipa>` | 上传一个已有的 IPA |
| `release <版本> [--date D] [--no-ship] [--no-submit] [--yes]` | 整条链，先打印计划再问一句 |
| `version status \| create \| whatsnew \| attach --wait \| submit \| cancel --yes` | 版本记录 |
| `builds` | 最近的构建及处理状态 |
| `listing check \| diff \| push <版本>` | 商店文案：离线查上限 / 与 ASC 对账 / 写入差异 |
| `media status \| upload \| mkset \| list \| delete` | 截图与预览的槽位 |
| `shots check \| render --sheet \| upload \| seed` | 商店截图（见下） |
| `preview record \| stop \| cut \| check \| upload` | App Preview 视频（见下） |
| `reel card \| pts \| make` | 竖版社交视频（见下） |
| `sim …` | 模拟器驱动（见下） |
| `offer list \| new \| csv \| off` | 订阅优惠码（ASC 网页里没有入口） |
| `device add`、`apps`、`analytics …` | 注册真机、列 App、报表 |
| `skill list \| install` | agent skill |

## 商店文案即代码

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

### 审核信息

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

## 它替你记住的坑

| 你看到 | 它告诉你 |
|---|---|
| 导出时 `No signing certificate "iOS Distribution" found` | xcodebuild 走了云签名，因为带了 `-authenticationKey*`。storeship 从不带；Xcode 在导出那一刻自己申请证书。导出不带密钥，上传才带。 |
| `401 NOT_AUTHORIZED` | id 错、密钥被吊销、`.p8` 不配、DER 签名（它签的是裸 R‖S）、或时钟偏差 |
| `The specified pre-release build could not be added` | 构建还在处理；用 `attach --wait` |
| 写名称 / 副标题 `409` | 撞到锁死的线上 appInfo 了；账号里有两个 |
| `ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH` | 中国大陆备案主体名 ≠ 开发者名；API 改不了 |
| `The API key in use does not allow this request` | 密钥角色不够（拉数据要 Admin） |
| 建优惠码 409 ×175 | 免费 offer 要列地区但不能带价格点；已替你从价格表抄 |
| 截图灰块 | 校验和错；它提交的是 MD5 |

## 它不做的事

- **不替你定版本号。** 改 `app.config`（`version` 和 `ios.buildNumber`）再 `expo prebuild`；`ios/` 和 `app.config` 不一致时 `ship` 拒绝。
- **不验界面。** 一个会因为截图比对失败而卡住的发布工具，下次没人敢用。截图和预览是独立命令，不在发布链上。
- **不自作主张撤回。** `cancel` 必须 `--yes`：撤回丢排队位置，而且能不能重提要到那一刻才知道。

## 截图

真实的模拟器截屏 + 模板 + 内容文件 → 每个设备档 × 每种语言精确尺寸的 PNG，先校验、出联系表、按 display type 上传。

```bash
storeship shots check                # 序号 / 标题 / 源图 / 裁剪，问题一次报完
storeship shots render --sheet       # PNG 进 shots.out + 每个设备档 × 语言一张联系表
storeship shots upload 1.4.0         # 进 ASC 对应的 set；只传新文件（--replace 全换）
storeship shots seed -- --locale en  # 跑你自己的种演示数据脚本（shots.seed），参数透传
```

源文件命名 `<prefix>-<localeTag>-<n>-<slug>.png`（`iphone-en-1-home.png`；同一张图的第二屏 `1b-<slug>`）。内置设备档：`iphone69`（1320×2868，APP_IPHONE_67）、`iphone67`、`iphone63`、`iphone65`、`iphone55`、`ipad13`（2064×2752，APP_IPAD_PRO_3GEN_129）、`ipad129`、`ipad11`；内容文件可以增加或覆盖。

**内容**——导出 `Shot[]`（或 `{ shots, devices?, template? }`）的模块：

```ts
import type { Shot } from 'storeship'
export default [
  { n: 1, slug: 'home', sn: 'HOME', bg: '#2FE9DF',
    title: { 'en-US': ['One playhead', 'the whole band'], 'zh-Hans': ['自动走针', '全员同一小节'] },
    cards: { iphone69: [{ x: 70, y: 820, w: 1400, h: 1185, sx: 0, sy: 0, sw: 1560 }] } },
] satisfies Shot[]
```

`cards[设备]` 是画布上的矩形；`sx/sy/sw` 是源图上的矩形（高度按卡片长宽比反推），所以裁剪永远是「放大看同一屏的一角」。缺某个设备档的排版是报错，不会静默出一张错图。

**模板**——可选；导出 `{ render(ctx) => html, titleLines?, titleMax?, snPattern? }` 的模块。`ctx` 有 `shot`、`locale`、`device`、`total`、`title`（这门语言的标题行）和 `cards`（各带 data-URI 的 `img` 和原生尺寸）。内置模板刻意朴素。

检查器拒绝：序号不连、标题行数不对或为空、源图缺失或尺寸不对、裁剪越界、卡片两侧同时出血（一个圆角都看不见 → 读成一条色带）、设备档没排版。这条路上的错误本来全是静默的。

## 模拟器驱动

```bash
storeship sim which                       # idb 还是 CGEvent 退路，目标是哪台
storeship sim statusbar                   # 9:41、满电、满格
storeship sim find "Play"                 # 按无障碍标签点（idb）
storeship sim tap 220 284                 # 设备逻辑点，竖屏
storeship sim ltap 330 1121               # 横屏页转正后截图上的像素
storeship sim drag 200 800 200 300
storeship sim shot out.png [270]          # 270 把横屏录的转正
storeship sim ls [pattern]                # 无障碍树
```

`--profile <设备档>` 按设备表选模拟器（配置里 `sim.profile`）；`--udid` 直接指定。**idb**（`idb ui tap`）收设备点，不需要窗口位置也不需要辅助功能授权。`brew install idb-companion` 在只装了完整 Xcode 的机器上装不上，用预编译包 + pip：

```bash
curl -L -o /tmp/idbc.tar.gz https://github.com/facebook/idb/releases/download/v1.5.0.b3/idb-companion.macos-arm64.tar.gz
mkdir -p ~/.local/opt/idb && tar -xzf /tmp/idbc.tar.gz -C ~/.local/opt/idb
python3 -m venv ~/.local/opt/idb/venv && ~/.local/opt/idb/venv/bin/pip install fb-idb
```

没有 idb 时退回 CGEvent（按模拟器窗口位置合成鼠标事件），要给终端辅助功能权限、目标窗口要在最前。

## App Preview 视频

```bash
storeship preview record seg1.mov --device iphone69   # simctl recordVideo；停要走…
storeship preview stop                                # …SIGINT——绝不要杀进程（会话泄漏，只有重启模拟器能救）
storeship preview cut out.mp4 seg1.mov:0:8:p seg2.mov:1:7 seg3.mov:1:7 --device iphone69 [--music song.wav]
storeship preview check out.mp4 --device iphone69     # 尺寸 / 15–30 秒 / ≤30fps / 帧数
storeship preview upload 1.4.0 out.mp4 --device iphone69 --locale en-US [--replace]
```

段的写法 `<文件>:<起点>:<时长>[:p]`；`:p` 表示竖屏页（加黑边不旋转——竖着的模拟器录横屏 App 出来是躺着的）。画布按设备档取 App Preview 尺寸（iPhone 1920×886、iPad 1200×1600；`--portrait` 或 `--size WxH` 覆盖）。每段先渲成定长恒定帧率的中间片，再叠化，再淡入淡出，配乐垫在下面。

为什么要中间片：`simctl` 录屏「有变化才写帧」。直接叠化会在接缝断流——时长对、帧数一半——而且对这种文件 `-t` 常常要不到那么长，所以叠化偏移按实际产出的时长算。`preview check` 对任何文件都会报帧数那个症状。

要 ffmpeg：`~/.local/opt/ffmpeg/ffmpeg`（静态版）、配置里的 `ffmpeg`、`STORESHIP_FFMPEG` 或 PATH。

## Reel（竖版社交视频）

录屏摆进设计好的卡片里，发小红书 / Reels / Shorts。

```bash
storeship reel card /tmp/card.png                 # 只看卡片层（带透明洞的 PNG）
storeship reel pts take.mov                       # 帧时间戳；等间隔那段 → 音频 t=0 该放的位置
storeship reel make take.mov out.mp4 --start 3.4 --duration 20 [--audio song.wav --audio-t0 3.43]
```

`reel.content` 指向导出 `{ canvas, band, crop?, rotate?, fps?, copy }` 的模块 / JSON；`reel.template` 可选，替换内置卡片（丝印行、两行带 `<em>` 高亮的标题、洞的微光圈、要点、品牌行——全部来自 `copy`，配色来自 `copy.colors`）。

- **卡片是带洞的前景。** `AVVideoCompositionCoreAnimationTool` 合出来的帧里，视频以外是黑的不是透明的，背景层会被盖掉。四块背板由工具生成；模板不许给卡片上底色。
- **`band.h` 是算出来的**：录屏转正、裁切、缩到 `band.w` 之后只有一个高度。对不上 `reel make` 拒绝并报出该填的数。
- **音频按帧时间戳对齐。** `simctl` 录屏没有 App 的声音。App 按拍重画的话，`reel pts` 能找出等间隔那段和它的第一帧；离线渲出音频，把那个时刻当 `--audio-t0`（录屏时间轴）。不是按下播放键那一帧。
- 要 Xcode 工具链（合成器是 Swift，编译一次缓存）和 Chrome（卡片）。

## 给 agent

每条命令都有 `--json`。`storeship skill install` 把 Claude Code skill 拷进 `.claude/skills/`：发版、截图、预览、reel 的操作规程，判断（版本号、要不要撤回、写什么）留给人。

**让 agent 把整条发布链跑完。** 实际会拦住它的只有两件事，都不在这个工具里：

1. **权限确认。** `release` 一条命令里包着 `xcodebuild`、`altool` 上传和好几次 App Store Connect 写入，权限分类器常常拒掉这一整条，而每一步单看都会放行。加一次允许规则就好（Claude Code 的 `.claude/settings.local.json`；pnpm 仓库用 `pnpm storeship *`，其余用 `npx storeship *`）：

   ```json
   { "permissions": { "allow": ["Bash(pnpm storeship *)", "Bash(npx storeship *)"] } }
   ```

   随包的 skill 也把发版拆成两条（先 `ship`，再 `release --no-ship`），构建那一半被拒不会连带把 App Store Connect 那一半也拖死。
2. **Xcode 没登账号。** `export` 要 Xcode → Settings → Accounts 里登着 Apple ID（会话会过期，升 Xcode 也会掉）。`storeship doctor` 的 `Xcode account` 一项在归档七分钟之前就报出来。登回去是图形界面操作；之后用 `release <版本> --archive <归档路径>` 从导出接着走，不必重新归档。

## 许可证

MIT
