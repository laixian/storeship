# Products as code: subscriptions and pricing

Subscription groups, subscriptions, prices, availability and the app's own price live in `products.md`, are diffed against App Store Connect, and only the differences are written. Commands: `storeship products check | status | diff | push | pricepoints | delete`, and `storeship offer …` for offer codes.

[← README](../README.md) · [command reference](commands.md) · [configuration](config.md) · [for agents](agents.md)

`products.md` (path: `catalog.file`) holds the subscription groups, the subscriptions, their prices and territories, and the app's own price. `products diff` prints every change it would make; `products push` makes them, creating what is missing and updating only what differs. It never deletes.

```markdown
## app
- price: CHN 0
- territories: all

## group OverDrive Pro
### en-US
#### name
OverDrive Pro

## subscription com.example.pro.monthly
- group: OverDrive Pro
- reference: Pro monthly
- period: ONE_MONTH
- level: 1
- price: USA 3.99
### en-US
#### name
Monthly
#### description
Everything, billed monthly
### reviewNote
```
How a reviewer reaches the paywall on a fresh install.
```
### reviewScreenshot
store/iap/monthly.png
```

**Pricing.** Apple's price points are discrete, about 800 per territory. You name one base territory and an amount; the tool picks the tier at or just below it and asks Apple's equalization table for the matching tier in every other territory — what the web UI does behind "generate prices for other territories". `products pricepoints <productId> USA --near 4` shows the tiers. Per-territory overrides go in `- prices: JPN 600, KOR 4900`; a scheduled change in `- priceStart: 2026-10-01`. A change never edits the old price row: it adds a new one, which is also how Apple keeps the history. Raising a live price prints a warning, because it starts Apple's subscriber-consent flow.

**What it cannot do.** Create the app record itself — the API has no endpoint for that; five minutes on the website, then `storeship init`. Change a subscription's product id or period after creation (Apple's rule; the diff warns). Submit a new subscription on its own: the first one goes for review together with the next app version.

`products delete <productId> --yes` exists for one reason: a subscription that was never submitted can be removed, and that is how the write path of this command is tested against a real account.
