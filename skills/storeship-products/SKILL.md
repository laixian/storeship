---
name: storeship-products
description: Set up or change App Store subscriptions and pricing with the storeship CLI — subscription groups, subscriptions, localized names, price tiers equalized across territories, availability, review screenshots, and the app's own price, all from products.md. Use when asked to add a subscription, change a price, localize a product, or set up in-app purchases.
---

# Subscriptions and pricing with storeship

Everything is one file, `products.md` (path `catalog.file`), diffed against App Store Connect before anything is written. Run commands as `storeship products … --json` and read the structure.

## Before anything

1. `storeship products status --json` — what the account has now: groups, subscriptions, state, base price, territory count, review screenshot.
2. `storeship products check` — the file parses and is within limits (group name 30, subscription name 30, description 45, review note 4000).

## Things that are the human's call — ask, do not decide

- **Product ids and periods.** Both are immutable once a subscription exists. Propose an id in the app's reverse-DNS style (`com.example.app.pro.monthly`) and show it before pushing.
- **Prices.** Show the tier that will actually be picked: `storeship products pricepoints <productId> <TERRITORY> --near <amount>`. Tiers are discrete; the tool picks at or below the amount, never above. Raising a live price triggers Apple's subscriber-consent flow — say so and wait.
- **Group level.** 1 is the highest tier in the group; upgrades/downgrades follow it.
- **Deleting anything.** `products delete` only exists for subscriptions that were never submitted; never run it without an explicit instruction naming the product id.

## The normal path

```bash
storeship products diff --json      # show the human every action
storeship products push --yes --json
```

`push` creates groups, subscriptions, localizations, prices (base territory + equalizations to every other territory), availability and the review screenshot, in that order, and updates only fields that differ. It is idempotent: on failure, read the hint, fix, run again.

A new subscription is **not** submitted by `push`. It goes for review with the next app version (`storeship version submit`); tell the human that.

## Writing the file

- Name / description are what the paywall shows; keep them within 30 / 45 characters per locale, in every locale the app's listing has.
- `reviewNote`: how a reviewer reaches the paywall on a fresh install, what the subscription unlocks, and that no account is needed (or which demo account). Fenced block.
- `reviewScreenshot`: a screenshot of the paywall as the reviewer will see it; the tool uploads it when the file's md5 differs from what ASC has. **This slot only accepts the older 1242×2208 size** — a 1290×2796 / 1320×2868 capture from a current iPhone is rejected; scale it and pad with the app's background (2026-08-18).
- `- territories: all` unless the human says otherwise. Availability is not optional: a subscription with no territories never returns a price in the sandbox, and nothing says why.

## Reading failures

- `409` on a price: the tier is not valid for that subscription (e.g. weekly tiers differ); run `pricepoints` and pick from the list.
- `409 ATTRIBUTE.NOT_ALLOWED` on `period` / `productId`: immutable; the diff already warned. A different period means a new subscription.
- `404` creating a localization: the subscription was just created and ASC has not indexed it; run `push` again.

## Never

- Never put a demo password or any credential in `products.md`.
- Never "fix" a price mismatch by editing territories one by one in the web UI while the file says otherwise — change the file and push.
