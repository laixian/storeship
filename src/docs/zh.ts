/**
 * Chinese text for the generated command reference. Keyed by command path;
 * anything missing falls back to the English in the command definitions, so
 * structure can never drift between the two languages.
 */
export type ZhEntry = { summary: string; flags?: Record<string, string>; human?: string[] }

const JSON_FLAG = 'stdout 上输出机器可读的 JSON；进度仍走 stderr'
const CONFIG_FLAG = '配置文件；默认从当前目录向上找 storeship.config.*'
const DEVICE_LIST = '设备档 id，逗号分隔'
const LOCALE_LIST = 'locale，逗号分隔'

const DRY_RUN = '只算出要做的改动并打印，什么都不写'

export const ZH_GLOBAL: Record<string, string> = {
  json: JSON_FLAG,
  config: CONFIG_FLAG,
  raw: '配合 --json：默认给的是精简过的结果，这个开关给完整原始数据',
  fields: '配合 --json：只保留 data 里这几个顶层字段（逗号分隔）',
}

export const ZH: Record<string, ZhEntry> = {
  init: {
    summary: '读工程（expo config）和 App Store Connect，生成 storeship.config.json',
    flags: {
      project: 'Expo / iOS 工程目录（相对配置根目录）；默认就是根目录',
      'key-id': 'App Store Connect API 密钥 id（和 --issuer-id 一起给时会去查 app id 和语言）',
      'issuer-id': 'App Store Connect issuer id',
      'key-path': '.p8 路径；默认 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8',
      'bundle-id': '要查的 bundle id；默认从 expo config 读',
      force: '覆盖已有的 storeship.config.json',
      'no-skills': '不要把 agent skill 拷进 .claude/skills',
      'no-permissions': '不要往 .claude/settings.local.json 里加 storeship 的放行规则',
    },
  },
  doctor: { summary: '逐项体检：Node、Xcode、密钥文件与权限、工程、配置，并实际用密钥请求一次（有问题退出码 3）' },
  state: {
    summary: '一次调用回答「发布走到哪了、下一步该跑什么」——agent 该跑的第一条命令',
    flags: { deep: '顺带把 products.md 和 App Store Connect 对一遍（请求多不少）', offline: '不连 App Store Connect，只看配置和工程说了什么' },
  },
  spec: { summary: '机器可读的接口本身：每条命令及其影响面，加上退出码表和错误码表' },
  ship: {
    summary: '归档 → 导出 IPA → 上传到 App Store Connect（版本号由你事先改好）',
    human: ['版本号和构建号：它们在 app.config 里，而且必须已经跑过 `npx expo prebuild`'],
    flags: { 'skip-upload': '只归档和导出，打印 IPA 路径留给 `upload`', force: 'app.config 和 ios/ 的版本号不一致（= 没跑 prebuild）时也照样构建', quiet: '不回显 xcodebuild / altool 的输出' },
  },
  export: { summary: '把一个已有的 .xcarchive 导出成 IPA（归档成功、导出失败之后从这里接着走）', flags: { quiet: '不回显 xcodebuild 的输出' } },
  upload: { summary: '用 altool 上传一个已导出的 IPA', flags: { quiet: '不回显 altool 的输出' } },
  release: {
    summary: '整条链：ship + 建版本 + What\'s New + 等构建挂上 + 提审',
    human: ['版本号和构建号（在 app.config 里）', '发布日期', "What's New 的文案", '到底提不提审'],
    flags: {
      date: '定时发布的日期；不给就是审核通过后手动发布',
      whatsnew: '放 <locale>.txt 的目录；默认 <whatsNew.dir>/<version>，没有就静默跳过',
      archive: '不再归档，直接导出并上传这个已有的 .xcarchive（导出或上传失败之后从这里接着走）',
      build: '要挂的构建号；默认刚构建的那个，--no-ship 时默认账号里最新的',
      'no-ship': '跳过归档 / 导出 / 上传（构建已经在 App Store Connect 里）',
      'no-submit': '挂上构建就停，不提审',
      'dry-run': '把计划当数据打出来就停：不构建、不上传、不写任何东西',
      yes: '不问确认（不在终端里跑时必须给）',
      quiet: '不回显 xcodebuild / altool 的输出',
      force: 'app.config 和 ios/ 的版本号不一致时也照样构建',
      timeout: '等构建变 VALID 的分钟数；默认 40',
    },
  },
  version: { summary: 'App Store 版本记录：状态、创建、What\'s New、挂构建、提审、撤回' },
  'version status': { summary: '列出各版本的状态、发布方式、定时日期' },
  'version create': { summary: '建版本记录；给了日期就是定时发布', human: ['版本号', '发布日期'], flags: { date: '定时发布到这一天（时刻取配置的 release.scheduledTime）；不给就是审核通过后手动发布', 'dry-run': DRY_RUN } },
  'version whatsnew': {
    summary: '给每种语言写「此版本的新增内容」',
    human: ["What's New 的文案本身"],
    flags: { dir: '放各语言 <locale>.txt 的目录；默认 <whatsNew.dir>/<version>', file: '单独指定某语言的文件，可重复：--file en-US=notes/en.txt', 'dry-run': '只打印要写的内容，不写' },
  },
  'version attach': { summary: '把构建挂到版本上（要 VALID）；--wait 等它变 VALID', flags: { build: '要挂的构建号（CFBundleVersion）；默认账号里最新的那个', wait: '每 30 秒轮询直到构建变 VALID（给了 --build 就是等它出现并变 VALID），而不是直接失败', timeout: '--wait 最多等的分钟数；默认 30' } },
  'version watch': { summary: '轮询到审核有结论为止；退出码 0 过审、3 被拒、4 还没结论', flags: { interval: '两次轮询之间的分钟数；默认 10', timeout: '最多守多少分钟；默认 1440（24 小时）', once: '只查一次就退出，不轮询' } },
  'version submit': { summary: '提交审核', human: ['这一版到底能不能送审'], flags: { 'dry-run': '只说会提交什么，不真提交' } },
  'version cancel': { summary: '撤回在审的提交单（单向：排队位置作废）', human: ['要不要放弃排队位置'], flags: { yes: '必须给：撤回是单向的，排队位置当场作废' } },
  builds: { summary: '最近的构建及其处理状态' },
  listing: { summary: '商店文案和审核信息以 Markdown 为真相源：查上限、和 ASC 对账、写入' },
  'listing check': { summary: '解析文案文件并检查字符上限（离线）' },
  'listing diff': { summary: '文案文件与 ASC 上某版本的现值逐格比较，不写；有差异时退出码 3' },
  'listing push': { summary: '把有差异的字段写进 ASC（名称 / 副标题在 appInfo 上，其余字段和审核信息在版本上）', human: ['商店文案本身，以及它能不能上线'], flags: { 'dry-run': '等同 `listing diff`：只给差异，不写' } },
  products: { summary: '订阅组 / 订阅 / 定价 / 可售地区 / App 定价，以 products.md 为真相源：查、对账、写入' },
  'products check': { summary: '解析 products.md 并离线检查上限与引用' },
  'products status': { summary: '打印 ASC 上现有的组、订阅、状态、基准地区价、地区数、审核截图' },
  'products diff': { summary: 'products.md 与 ASC 逐项比较，打印要做的每一步；不写，有差异时退出码 3' },
  'products push': { summary: '按 diff 的计划写入：建组 / 建订阅 / 语言 / 价格（基准地区等价到全部地区）/ 可售地区 / 审核截图', human: ['定价、可售地区，以及在售价格能不能改'], flags: { yes: '不问确认（不在终端里跑时必须给）', 'dry-run': '等同 `products diff`：只给计划，不写' } },
  'products pricepoints': { summary: '列出某订阅在某地区的价格档位（Apple 的档位是离散的，写价格前先看）', flags: { near: '只列这个数附近的档' } },
  'products delete': { summary: '删掉一个从未提交过的订阅（ASC 只允许删这种）', flags: { yes: '必须给：删了就没了', 'with-group': '如果这是组里最后一个订阅，把空组也删掉' } },
  media: { summary: '截图与预览视频：按语言 × 设备档看状态、上传、建槽位' },
  'media status': { summary: '每语言每设备档有几张截图、几条预览（以及 set id）' },
  'media upload': { summary: '把文件传进一个 set（顺序 = 展示顺序）', flags: { 'dry-run': '只列出会传什么，不传' } },
  'media list': { summary: '某个 set 里的条目及其投递状态' },
  'media mkset': { summary: '给某语言建一个空槽位（每种设备类型传第一次之前要建）' },
  'media delete': { summary: '按 id 删一张截图 / 一条预览', flags: { yes: '必须给：删掉之后只能重新上传，而且整组的展示顺序会变' } },
  offer: { summary: '订阅优惠码（App Store Connect 网页里没有入口）' },
  'offer list': { summary: '每个已配置商品的 offer 和码批次', flags: { product: '只看一个商品（配置里的别名或订阅 id）；默认全部' } },
  'offer new': {
    summary: '建一个免费 offer、发一批一次性码、下载 CSV',
    human: ['发多少个码、免费多久、谁有资格'],
    flags: {
      name: 'offer 名称，同一商品下必须唯一',
      product: '配置里的别名或订阅 id；默认第一个已配置商品',
      duration: '免费期的单位：THREE_DAYS / ONE_WEEK / TWO_WEEKS / ONE_MONTH / TWO_MONTHS / THREE_MONTHS / SIX_MONTHS / ONE_YEAR；默认 ONE_YEAR',
      periods: '几个单位；默认 1',
      codes: '发多少个一次性码；默认 500',
      expires: '码能兑换的最后一天（YYYY-MM-DD，最多约 6 个月）；默认今天 + 175 天',
      eligibility: 'NEW / EXISTING / EXPIRED，逗号分隔；默认 NEW',
      renew: '免费期结束后按标准价自动续订（Apple 的默认值；本工具默认关，而且事后改不了）',
      out: 'CSV 路径；默认 offer-codes-<name>.csv',
      'dry-run': '只打印会建成什么样的 offer，不建',
    },
  },
  'offer csv': { summary: '重新下载某一批次的 CSV', flags: { batch: '`offer list` 里的批次 id', out: 'CSV 路径；默认 offer-codes-<batch>.csv' } },
  'offer off': { summary: '停用一个 offer 连同它所有批次（已发的码当场作废）', flags: { offer: '`offer list` 里的 offer id', yes: '必须给：已经发出去的码当场全部失效，而且这个 offer 停了就不能再启用' } },
  device: { summary: '注册真机（装开发签名的包要用）' },
  'device add': { summary: '注册一台设备' },
  apps: { summary: '账号里的 App（用来找 app id）' },
  analytics: { summary: 'Analytics Reports API 与每日销售（要 Admin / Sales 角色的密钥）' },
  'analytics request': { summary: '向 Apple 申请一份报表快照（数据隔天出）', flags: { access: 'ONE_TIME_SNAPSHOT（默认）或 ONGOING' } },
  'analytics list': { summary: '已申请的报表及各自有几份实例' },
  'analytics fetch': { summary: '下载某报表最新一份实例，打成表', flags: { granularity: 'DAILY（默认）/ WEEKLY / MONTHLY' } },
  'analytics sales': { summary: '某 vendor number 的当日销售汇总' },
  shots: { summary: 'App Store 截图：校验、用真实截屏 + 模板渲染、联系表、按设备类型上传' },
  'shots check': { summary: '校验内容、源图、裁剪，每个设备档的问题一次报完', flags: { device: DEVICE_LIST + '；默认内容里排了版的全部设备档（或 shots.devices）', locale: LOCALE_LIST + '；默认配置里的' } },
  'shots render': { summary: '渲染整套（先校验）；--sheet 顺带出每个设备档 × 语言的联系表', flags: { device: DEVICE_LIST, locale: LOCALE_LIST, only: '只重出这几张（序号，逗号分隔）', sheet: '同时在临时目录里出一张联系表' } },
  'shots upload': { summary: '把渲好的截图按 display type 传进 App Store Connect（默认只传缺的）', flags: { device: DEVICE_LIST, locale: LOCALE_LIST, replace: '先删光那个 set 里的截图', 'dry-run': '只打印计划，不动任何东西' } },
  'shots seed': { summary: '对模拟器跑项目自己的种演示数据脚本（参数原样透传）' },
  sim: {
    summary: '驱动开着的模拟器：点 / 拖 / 截图 / 状态栏 / 无障碍树（优先 idb，退路 CGEvent）',
    flags: { profile: '设备档 id（按名字选模拟器）；默认配置的 sim.profile，否则唯一开着的那台', udid: '改用 UDID 指定模拟器' },
  },
  'sim which': { summary: '当前走哪条输入通道、目标是哪台模拟器' },
  'sim tap': { summary: '按设备逻辑点（竖屏）点一下' },
  'sim ltap': { summary: '按转正后（横屏）截图上量到的像素点一下' },
  'sim drag': { summary: '在两个设备点之间拖' },
  'sim shot': { summary: '截图；横屏页给 270' },
  'sim statusbar': { summary: '把状态栏改成 9:41 / 满电 / 满格', flags: { time: '时钟文字；默认 9:41' } },
  'sim ls': { summary: '无障碍元素列表（要 idb）；可给子串过滤' },
  'sim find': { summary: '点第 n 个标签含该文字的元素（要 idb）' },
  'sim text': { summary: '往当前焦点输入文字（要 idb）' },
  preview: { summary: 'App Preview 视频：录模拟器、把 VFR 录屏剪成规格尺寸的成片、校验、上传' },
  'preview record': { summary: '开始录开着的模拟器（用 `preview stop` 停；绝不要杀进程）', flags: { device: '设备档 id；用它的模拟器名选开着的那台', udid: '改用 UDID 指定' } },
  'preview stop': { summary: '干净地停止录制（SIGINT），不把会话泄漏在 CoreSimulator 里' },
  'preview cut': {
    summary: '多段 → 定长 CFR 中间片 → 叠化 → 淡入淡出（+ 配乐），尺寸按设备档取预览规格',
    human: ['哪一条素材的哪几秒进成片'],
    flags: {
      device: '设备档 id → 它的 App Preview 尺寸（iPhone 横、iPad 竖）',
      size: '不用 --device，直接给画布 WxH',
      portrait: '配合 --device：用竖版尺寸',
      music: '垫在片子下面的音频，淡入 1 秒 / 淡出 1.5 秒，按片长截断',
      fps: '成片的恒定帧率；默认 30',
      xfade: '段与段之间叠化的秒数；默认 0.5',
    },
  },
  'preview check': { summary: '按 App Preview 规格查尺寸 / 时长 / 帧率 / 帧数', flags: { device: '按这个设备档的预览类型查；不给则任一 App Preview 尺寸都算过' } },
  'preview upload': { summary: '把预览传进某语言 × 设备档的槽位（没有就建）', flags: { device: '设备档 id → 预览类型 / 槽位', locale: 'ASC locale 码', replace: '先删掉槽位里已有的预览', 'dry-run': '只查文件和槽位，不上传' } },
  reel: { summary: '竖版社交视频：录屏摆进设计好的卡片里，音频按帧时间戳对齐' },
  'reel card': { summary: '把卡片层（视频处是透明洞）渲成 PNG' },
  'reel make': {
    summary: '录屏（+ 音频）→ mp4；每次现渲卡片',
    human: ['取录屏的哪几秒，以及音乐落在哪里'],
    flags: { start: '从录屏的第几秒开始；默认 0', duration: '取几秒；默认到结尾', audio: '垫在画面下面的音频文件', 'audio-t0': '音频的 t=0 落在录屏时间轴的第几秒；由 `reel pts` 给', card: '用这张卡片 PNG，不现渲' },
  },
  'reel pts': { summary: '录屏每帧的时间戳，以及等间隔连续帧那几段（其中第一帧就是音频 t=0 该放的位置）', flags: { all: '逐帧打印，不只打印等间隔段' } },
  skill: { summary: '驱动本工具的 agent skill（Claude Code 格式）' },
  'skill list': { summary: '随包的 skill' },
  'skill install': { summary: '把 skill 拷进项目（默认 .claude/skills）', flags: { to: '目标目录；默认 <配置根目录>/.claude/skills', only: '只装这一个' } },
  'skill check': { summary: '检查一份 skill 副本和当前版本对不对得上：生成块是否过期、版本戳、提到的命令还在不在（有问题退出码 3）', flags: { dir: '放 storeship-* skill 的目录；默认本包自带的那份' } },
  'skill sync': { summary: '按代码重新生成 skill 里的标记块（协议、错误码）和版本戳', flags: { dir: '放 storeship-* skill 的目录；默认本包自带的那份', check: '不写，只要有文件会变就退出码 3（CI 用）' } },
  docs: { summary: '把命令树生成 Markdown 参考（docs/commands.md 就是它出的）', flags: { lang: 'en（默认）或 zh', check: '和这个文件比较，不同则退出 3（CI 用）' } },
}

/**
 * Chinese for the agent contract: the exit-code and error-code tables that
 * `storeship skill sync` writes into the skills and the agent docs. Keyed by
 * the code itself, so a new code without a translation fails the docs test
 * rather than silently appearing in English.
 */
export const ZH_EXIT: Record<string, { meaning: string; agent: string }> = {
  ok: { meaning: '命令做了它说的那件事', agent: '继续' },
  error: { meaning: '命令失败了', agent: '看 error.code 和 error.retry；retry 是 never 就别重来' },
  usage: { meaning: '命令行写错了', agent: '改命令，绝不要原样重试' },
  no: { meaning: '跑成了，但答案是否定的：被拒、超限、过期、有差异', agent: '按数据分支——这是结果，不是故障' },
  pending: { meaning: '还没结论：还在处理、还在审、还在构建', agent: '等一会儿再问；答案会自己变' },
  human: { meaning: '只有人能往下走：图形界面操作、密钥，或不可撤销的一步', agent: '停下来，把 error.humanAction 原话告诉人' },
  aborted: { meaning: '确认那一步，人回答了否', agent: '停' },
}

export const ZH_ABOUT: Record<string, string> = {
  UNKNOWN: '本工具没认出来的错误；message 是原文',
  USAGE: '参数或 flag 写错了',
  CONFIG: '配置文件、或它该有的某个标识符，缺了',
  NEEDS_HUMAN: '需要一次确认、一个密钥，或一个没有任何 flag 能替代的图形界面操作',
  ABORTED: '人回答了否',
  CHECK_FAILED: '离线校验发现问题；什么都没写',
  DIFFERS: '文件和 App Store Connect 对不上；什么都没写',
  PREFLIGHT: '磁盘上的工程不是你要发的那个（prebuild、版本号、bundle id）',
  NOT_FOUND: 'App Store Connect 上没有这个对象',
  TIMEOUT: '等到超时放弃了；等的那件事可能仍会发生',
  MISSING_TOOL: '这条命令要用的外部东西不在（Chrome、ffmpeg、idb、Xcode、开着的模拟器）',
  PENDING: '东西在，但还没就绪；过一会儿再问答案就不一样了',
  API: 'App Store Connect 拒绝了，原因只在 Apple 的报文里',
  AUTH: 'Apple 不认这把密钥',
  KEY_ROLE: '这把密钥的角色不够调这个接口',
  KEY_MISSING: '.p8 不在该在的位置，而它只能下载一次',
  ALTOOL_KEY_NOT_FOUND: 'altool 只在它自己那四个目录里找 .p8，一个都没找到',
  BUILD_NOT_PROCESSED: '构建还不是 VALID，或者还没出现在列表里',
  VERSION_NOT_EDITABLE: '这个版本在当前状态下是只读的',
  XCODE_NO_ACCOUNT: 'Xcode 没登 Apple ID，导出拿不到证书',
  CLOUD_SIGNING: 'xcodebuild 走了云签名；那句报错指的是错的方向',
  ICP_MISMATCH: '中国大陆 ICP 备案主体对不上，只能在 API 之外解决',
  PRICING_INVALID: '价格点、或它背后的可售地区，对这个订阅不成立',
  ATTRIBUTE_IMMUTABLE: '这个属性只能在创建对象时设',
  NODE_TS_STRIPPING: 'Node 拒绝跑 node_modules 里的 .ts',
}
