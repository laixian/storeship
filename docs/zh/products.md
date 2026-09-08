# 产品即代码：订阅与定价

订阅组、订阅、价格、可售地区和 App 自身定价放在 `products.md` 里，先和 App Store Connect 对账，只写差异。命令：`storeship products check | status | diff | push | pricepoints | delete`，优惠码走 `storeship offer`。

[← README](README.md) · [命令参考](commands.md) · [配置参考](config.md) · [给 agent 用](agents.md)

`products.md`（路径 `catalog.file`）里放订阅组、订阅、价格与可售地区、App 自己的定价。`products diff` 把要做的每一步打印出来，`products push` 才做：缺的建、不同的改，从不删。

```markdown
## app
- price: CHN 0
- territories: all

## group OverDrive Pro
### zh-Hans
#### name
OverDrive Pro会员

## subscription com.example.pro.monthly
- group: OverDrive Pro
- reference: Pro 月付
- period: ONE_MONTH
- level: 1
- price: CHN 12
### zh-Hans
#### name
月度订阅
#### description
全部功能，按月
### reviewNote
```
审核员在全新安装上怎么走到付费墙。
```
### reviewScreenshot
store/iap/monthly.png
```

**定价。** Apple 的价格档位是离散的，每个地区约 800 档。你只写一个基准地区和一个数，工具选不高于它的最近一档，再按 Apple 的等价表取其他每个地区对应的档——网页上「为其他地区生成价格」做的就是这件事。`products pricepoints <productId> CHN --near 12` 能看档位。个别地区要另定就写 `- prices: JPN 600, KOR 4900`；排期改价写 `- priceStart: 2026-10-01`。改价从不改旧的一行，只加新的一行，Apple 自己也是这么留历史的。给已上架的订阅涨价会打印提醒，因为那会触发 Apple 的用户同意流程。

**做不到的。** 建 App 记录本身——API 没有这个接口，网页上五分钟，然后 `storeship init`。建好之后改订阅的 product id 或周期（Apple 的规矩，diff 会警告）。单独提交一个新订阅：第一个订阅要随下一个 App 版本一起提审。

`products delete <productId> --yes` 只为一件事存在：从未提交过的订阅可以删，这条命令的写路径就是这样对着真账号验的。
