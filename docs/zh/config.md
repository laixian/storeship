# 配置参考

storeship 只读一个文件：`storeship.config.json`（或导出同一个对象的 `.ts` / `.mjs` / `.js`），从当前目录向上找。文件里的相对路径一律**相对该文件所在目录**解析，与 shell 的 cwd 无关，所以在任何子目录都能跑。

标识符（app id、key id、issuer id、team id）不是密钥，放进仓库；唯一的秘密是 `.p8` 私钥，它留在仓库外。

```json
{
  "app":      { "id": "1234567890", "bundleId": "com.example.app", "name": "Example" },
  "asc":      { "keyId": "ABC123DEF4", "issuerId": "00000000-0000-0000-0000-000000000000", "teamId": "TEAM123456" },
  "locales":  ["en-US", "zh-Hans"],
  "ios":      { "projectDir": "apps/mobile" },
  "listing":  { "file": "store/listing.md" },
  "whatsNew": { "dir": "store/whats-new" },
  "release":  { "scheduledTime": "08:00:00-07:00" },
  "products": { "monthly": "1234567891", "yearly": "1234567892" },
  "shots":    { "src": "store/screenshots", "out": "store/shots", "content": "store/shots/content.ts",
                "template": "store/shots/template.ts", "devices": ["iphone69", "ipad13"],
                "localeTags": { "zh-Hans": "zh", "en-US": "en" }, "seed": "store/shots/seed.ts" },
  "reel":     { "content": "store/reel/content.ts" },
  "sim":      { "profile": "iphone69" }
}
```

## 各键

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `app.id` | string | — | App Store Connect 的 app id（数字）。`storeship init` 按 bundle id 查；`storeship apps` 列出账号里的。环境变量 `ASC_APP_ID` 覆盖 |
| `app.bundleId` | string | — | Bundle identifier。`ship` 发现 `ios/` 里的不一致会拒绝 |
| `app.name` | string | — | 只是备注 |
| `asc.keyId` | string | — | API 密钥 id（App Store Connect → 用户和访问 → 集成）。`ASC_KEY_ID` |
| `asc.issuerId` | string | — | 同一页上的 issuer id。`ASC_ISSUER_ID` |
| `asc.keyPath` | 路径 | `~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8` | `.p8` 的位置。altool 也在这儿找，所以一个位置两边共用。`ASC_KEY_PATH` |
| `asc.teamId` | string | — | Apple team id，写进生成的 ExportOptions.plist。`init` 从 expo config 的 `ios.appleTeamId` 读。`ASC_TEAM_ID` |
| `locales` | string[] | `[]` | 你本地化了的 ASC locale 码，如 `en-US`、`zh-Hans`、`ja`。`whatsnew` / `listing` / `shots` / `preview` 都用它 |
| `ios.projectDir` | 路径 | 配置所在目录 | 放 `app.config.*` / `app.json` 和 `ios/` 的目录 |
| `ios.workspace` | 路径 | `<projectDir>/ios` 下第一个 `*.xcworkspace` | 要归档的 workspace |
| `ios.scheme` | string | workspace 的文件名 | 要归档的 scheme |
| `ios.infoPlist` | 路径 | `<projectDir>/ios/<scheme>/Info.plist` | 预检读原生版本号 / 构建号的地方 |
| `ios.configuration` | string | `Release` | 构建配置 |
| `ios.archiveDir` | 路径 | `~/Library/Developer/Xcode/Archives` | 归档落在 `<archiveDir>/<日期>/<scheme> <版本> build <n>.xcarchive`，Xcode Organizer 看得到 |
| `ios.exportOptions` | object | `{}` | 追加进生成的 ExportOptions.plist（基础：`method=app-store-connect`、`signingStyle=automatic`、`uploadSymbols=true`、`destination=export`） |
| `ios.expo` | boolean | 自动 | 纯原生工程写 `false`（跳过 `expo config` 预检）。默认按有没有 `app.config.*` / `app.json` 判断 |
| `listing.file` | 路径 | `store-listing.md` | 商店文案文件，格式见 README |
| `whatsNew.dir` | 路径 | `whats-new` | `version whatsnew` 和 `release` 读 `<dir>/<版本>/<locale>.txt` |
| `release.scheduledTime` | string | `00:00:00Z` | 定时发布时接在 `--date` 后面的时刻 + 时区，如 `08:00:00-07:00` |
| `products` | object | `{}` | 别名 → 订阅 id，给 `offer` 用 |
| `shots.src` | 路径 | `store/screenshots` | 模拟器原始截屏，`<prefix>-<localeTag>-<n>-<slug>.png` |
| `shots.out` | 路径 | `store/shots` | 渲好、可直接传 ASC 的 PNG |
| `shots.content` | 路径 | — | 导出 `Shot[]` 或 `{ shots, devices?, template? }` 的模块 / JSON。`shots` 必填 |
| `shots.template` | 路径 | 内置 | 导出模板 `{ render(ctx), titleLines?, titleMax?, snPattern? }` 的模块 |
| `shots.devices` | string[] | 内容里排了版的全部设备档 | 默认渲哪些设备档 |
| `shots.locales` | string[] | `locales` | 渲哪些语言 |
| `shots.localeTags` | object | `{}` | locale 码 → 文件名里的短标签，如 `{"zh-Hans": "zh"}` |
| `shots.seed` | 路径 | — | `shots seed` 跑的项目脚本，参数原样透传 |
| `reel.content` | 路径 | — | 导出 `{ canvas, band, crop?, rotate?, fps?, copy }` 的模块 / JSON。`reel` 必填 |
| `reel.template` | 路径 | 内置 | 导出 `{ render(ctx), css?(ctx) }` 的模块 |
| `sim.profile` | string | — | `sim` / `preview record` 默认的设备档 id（按该设备的模拟器名选机器） |
| `sim.idb` | 路径 | `~/.local/opt/idb/venv/bin/idb`，其次 PATH | idb 可执行文件。`STORESHIP_IDB` |
| `chrome` | 路径 | /Applications 下的 Chrome / Chromium / Edge，其次 PATH | `shots` 和 `reel card` 用的无头浏览器。`STORESHIP_CHROME` |
| `ffmpeg` | 路径 | PATH，其次 `~/.local/opt/ffmpeg/ffmpeg` | `preview` 用的 ffmpeg。`STORESHIP_FFMPEG` |

## 环境变量

| 变量 | 覆盖 | 典型用法 |
|---|---|---|
| `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_PATH` | `asc.*` | 临时换一把密钥跑一条命令（比如拉 `analytics` 要 Admin 的 key），不动文件 |
| `ASC_APP_ID`、`ASC_TEAM_ID` | `app.id`、`asc.teamId` | CI，或同一仓库里的第二个 App |
| `STORESHIP_CHROME`、`STORESHIP_FFMPEG`、`STORESHIP_IDB` | `chrome`、`ffmpeg`、`sim.idb` | 每台机器上工具的位置 |
| `STORESHIP_DEBUG` | — | 非预期错误时打印堆栈 |

## 设备档表

内置：`iphone69`（1320×2868，`APP_IPHONE_67`，iPhone 17 Pro Max）、`iphone67`（1290×2796）、`iphone63`（1206×2622，`APP_IPHONE_61`，iPhone 17 Pro）、`iphone65`（1284×2778）、`iphone55`（1242×2208）、`ipad13`（2064×2752，`APP_IPAD_PRO_3GEN_129`，iPad Pro 13-inch (M5)）、`ipad129`（2048×2732）、`ipad11`（1668×2388）。截图内容文件可以增加或覆盖（`devices: { myId: { id, w, h, srcW, srcH, displayType, unit, prefix, sim } }`）。同一张表也决定每个设备档对应的 App Preview 类型和尺寸。
