---
name: storeship-products
description: Set up or change App Store subscriptions, pricing and offer codes with the storeship CLI — subscription groups, subscriptions, localized names, price tiers equalized across territories, availability, review screenshots, the app's own price (all from products.md), and free offer codes to give a subscription away. Use when asked to add a subscription, change a price, localize a product, set up in-app purchases, or generate redemption / offer / promo codes.
---

# Subscriptions and pricing with storeship

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

Everything is one file, `products.md` (path `catalog.file`), diffed against App Store Connect before anything is written.

## How you talk to this tool

<!-- storeship:protocol -->
Every command takes `--json` and answers with one envelope:

```json
{ "ok": true, "command": "version attach", "data": {}, "changed": [], "warnings": [], "next": [{ "command": "…", "why": "…", "impact": "write" }] }
{ "ok": false, "error": { "code": "BUILD_NOT_PROCESSED", "message": "…", "hint": "…", "retry": "after-wait", "humanAction": null } }
```

`ok` says whether the command ran, never whether the answer was yes. The exit code says that:

| exit | meaning | what to do |
|---|---|---|
| 0 | the command did what it says | continue |
| 1 | the command failed | read error.code and error.retry; do not repeat a `never` |
| 2 | the command line was wrong | fix the command, never retry it unchanged |
| 3 | it ran, and the answer is negative: rejected, over limit, out of date, something differs | branch on the data; this is a result, not a failure |
| 4 | no verdict yet: still processing, still in review, still building | wait and ask again; the answer will change on its own |
| 5 | only a person can continue: a GUI action, a secret, or an irreversible step | stop and tell the human exactly what error.humanAction says |
| 130 | a person answered no at a confirmation | stop |

Branch on `error.code`, never on the message. `retry: "never"` means running it again changes nothing.
Read `next` — it is what this tool would do next, and it never contains an irreversible command.
<!-- /storeship:protocol -->

`storeship state --json` says where the release is and what to run next; `storeship spec --json` is the whole command tree with each command's impact and prerequisites.

## Before anything

1. `storeship products status --json` — what the account has now: groups, subscriptions, state, base price, territory count, review screenshot.
2. `storeship products check` — the file parses and is within limits (group name 30, subscription name 30, description 45, review note 4000). Exit 3 means it does not.

## Things that are the human's call — ask, do not decide

- **Product ids and periods.** Both are immutable once a subscription exists. Propose an id in the app's reverse-DNS style (`com.example.app.pro.monthly`) and show it before pushing.
- **Prices.** Show the tier that will actually be picked: `storeship products pricepoints <productId> <TERRITORY> --near <amount>`. Tiers are discrete; the tool picks at or below the amount, never above. Raising a live price triggers Apple's subscriber-consent flow — say so and wait.
- **Group level.** 1 is the highest tier in the group; upgrades/downgrades follow it.
- **Deleting anything.** `products delete` and `offer off` are marked irreversible: they refuse to run without `--yes`, and nothing in a `next` list will ever suggest them. Pass `--yes` only when the human named that exact product or offer.

## The normal path

```bash
storeship products diff --json      # show the human every action; exit 3 = something differs
storeship products push --yes --json
```

`products diff` and `products push --dry-run` produce the same change set; `changed[]` in the envelope is the list to show.

`push` creates groups, subscriptions, localizations, prices (base territory + equalizations to every other territory), availability and the review screenshot, in that order, and updates only fields that differ. It is idempotent: on failure, read the hint, fix, run again.

A new subscription is **not** submitted by `push`. It goes for review with the next app version (`storeship version submit`); tell the human that.

## Writing the file

- Name / description are what the paywall shows; keep them within 30 / 45 characters per locale, in every locale the app's listing has.
- `reviewNote`: how a reviewer reaches the paywall on a fresh install, what the subscription unlocks, and that no account is needed (or which demo account). Fenced block.
- `reviewScreenshot`: a screenshot of the paywall as the reviewer will see it; the tool uploads it when the file's md5 differs from what ASC has. **This slot only accepts the older 1242×2208 size** — a 1290×2796 / 1320×2868 capture from a current iPhone is rejected; scale it and pad with the app's background (2026-08-18).
- `- territories: all` unless the human says otherwise. Availability is not optional: a subscription with no territories never returns a price in the sandbox, and nothing says why.

## Reading failures

Branch on `error.code`, never on Apple's wording (`storeship spec --json` has the whole table):

- `PRICING_INVALID` — the tier is not one of that subscription's, or availability was never set. Run `products pricepoints <productId> <TERRITORY> --near <amount>` and pick from the list.
- `ATTRIBUTE_IMMUTABLE` on `period` / `productId` — set at creation only; the diff already warned. A different period means a new subscription.
- `NOT_FOUND` right after creating a localization — ASC has not indexed the new subscription yet; run `push` again.

## Offer codes: giving a subscription away

A different job from the file above, same command family. Offer codes let someone redeem a subscription for free, with no server and no back door in the entitlement logic — Apple records the subscription on their account and the app keeps reading the one source of truth it always reads. **App Store Connect has no web UI for these at all**; this is the only route.

```bash
storeship offer list --json                     # existing offers and code batches per product
storeship offer new --name "launch-2026" --product yearly --duration ONE_YEAR --codes 500 --json
storeship offer csv --batch <id> --out codes.csv   # re-download a batch
storeship offer off --offer <id> --yes          # kills every code in it, immediately
```

`offer new` creates the offer, issues a one-time-use batch and writes the CSV. The second column of each row is a redemption link you can hand to a person directly.

Three things only Apple's validator would otherwise tell you, all already handled by the tool — do not "fix" them by hand:

- A free offer still needs a non-empty territory list; it says *where* the code can be redeemed, not what it costs. The list is copied from the product's current price table, never typed, because a territory left out simply cannot redeem.
- `autoRenewEnabled` can only be set when the offer is created. Apple's default is **true** — the subscription renews at full price when the free period ends. storeship defaults it to **false**; `--renew` opts in. There is no way to change it afterwards, so ask which one the human wants before creating.
- The app must be **Ready for Sale** before any code can be redeemed. During review you can only verify that the redemption sheet opens.

Judgement calls to put to the human: the offer name (unique per product, and it is permanent), how many codes, the expiry (`--expires`, at most about six months out), and eligibility (`--eligibility NEW,EXISTING,EXPIRED`; default NEW only, which excludes your current subscribers).

## Never

- Never run `offer off` on your own initiative: every code in that offer stops working the moment you do, including ones already handed out.
- Never put a demo password or any credential in `products.md`.
- Never "fix" a price mismatch by editing territories one by one in the web UI while the file says otherwise — change the file and push.
