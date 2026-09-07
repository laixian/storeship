# From zero to "Waiting for Review"

This is the whole path for a first release of an Expo / React Native iOS app with storeship, in the order things have to happen. Later releases are the short version at the end.

## 0. What you need

- A Mac with Xcode, Node ≥ 22.18, and your app building for a device already (`npx expo run:ios --device` works).
- An Apple Developer Program membership, and in App Store Connect: the **app record** (name, bundle id, SKU, primary language) and any extra **localizations** you want (App Information → Localizable information). Paid apps also need the agreements / banking / tax steps done — none of that is scriptable.
- An **App Store Connect API key** with the *App Manager* role (Users and Access → Integrations → App Store Connect API). Download the `.p8` once — it cannot be downloaded again — and put it at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`, `chmod 600`. Note the key id and the issuer id.

## 1. Install and configure

```bash
npm i -D storeship
npx storeship init --key-id ABC123DEF4 --issuer-id 00000000-0000-0000-0000-000000000000 [--project apps/mobile]
npx storeship doctor
```

`init` reads `expo config` for the bundle id and team id, asks App Store Connect for the app id and the localizations, and writes `storeship.config.json`. `doctor` checks everything the later steps need and says how to fix each miss. Commit the config file; it holds identifiers, not secrets.

If Claude Code will be doing this with you, also `npx storeship skill install` (copies the four skills into `.claude/skills/`) and add the permission rule from README → *For agents*.

## 2. Set the version and generate the native project

The version number is a judgement, so the tool never changes it. Edit `app.config.*`: `version` (what users see) and `ios.buildNumber` (must increase with every upload, even for the same version). Then:

```bash
npx expo prebuild
```

`ship` compares `app.config` with `ios/…/Info.plist` and refuses when they disagree — that is the "forgot to prebuild" trap, caught before an upload burns a build number.

## 3. Store metadata as a file

Write `store-listing.md` (path: `listing.file`):

```markdown
## en-US
### name
Example
### subtitle
One line, 30 chars
### keywords
comma,separated,no spaces,100 chars
### description
```
Up to 4000 characters. A fenced block is taken verbatim.
```
### promotionalText
Up to 170 characters; the only field editable while live.

## review
### notes
```
How a reviewer reaches every feature on one device, what each permission
is for, where the paywall is. Up to 4000 characters. This is the field
that decides most rejections.
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
reviewer@example.com        (leave the field out if there is no sign-in)
### demoAccountRequired
true
```

The demo password goes in the environment (`ASC_DEMO_PASSWORD`), never in the file.

`npx storeship listing check` validates the limits offline. Name and subtitle live on the app; keywords, description and promotional text live on each version, so the version record has to exist before you can diff or push (step 6).

## 3b. Subscriptions and pricing (paid apps)

Write `products.md` (path: `catalog.file`): the group, each subscription with its period, level, base price and localized name / description, and `## app` for the app's own price (format in README → *Products as code*). Then:

```bash
npx storeship products check                   # limits and references, offline
npx storeship products pricepoints com.example.pro.monthly USA --near 4   # the tiers Apple offers
npx storeship products diff                    # every change it would make
npx storeship products push                    # create / update; never deletes
```

The first subscription is submitted for review together with the app version (step 7), not on its own. The App Store Connect app record itself is the one thing no command creates: make it on the website first.

## 4. Screenshots

Every device family you support needs a set (6.9" iPhone at least; 13" iPad when `supportsTablet`). Screenshots come from the simulator and are composed onto a canvas with a title.

1. Install a **Release** build on the simulator you shoot on (`npx expo run:ios --device "iPhone 17 Pro Max" --configuration Release`). Debug builds show developer UI and, once you take a screenshot with a Release build, Metro no longer updates it — that is expected.
2. Plant demo data if your app needs it (a script of yours, hooked up as `shots.seed`), restart the app, then `npx storeship sim statusbar` (9:41, full battery).
3. Capture each screen into `shots.src` as `<prefix>-<localeTag>-<n>-<slug>.png`: `npx storeship sim find "Play"` to tap by accessibility label, `sim tap x y`, `sim shot iphone-en-1-home.png` (add `270` for a landscape page). Repeat per locale by switching the app's language.
4. Describe the set in `shots.content` (a `Shot[]`: number, slug, background, title lines per locale, crop rectangles per device) — see the README for the shape and the built-in template, or write your own template.
5. `npx storeship shots check` until it is clean, `npx storeship shots render --sheet`, and **look at the contact sheet**: single frames all look fine on their own; only the row shows clashing colours or a broken progression.
6. Upload after the version exists (step 6): `npx storeship shots upload <version>`. Sets are matched by device type per locale; only new files are sent.

## 5. Preview video (optional)

```bash
npx storeship preview record seg1.mov --device iphone69   # drive the app with `storeship sim …`
npx storeship preview stop                                # never kill the process
npx storeship preview cut out.mp4 seg1.mov:0:8:p seg2.mov:1:7 --device iphone69 [--music song.wav]
npx storeship preview check out.mp4 --device iphone69
```

Upload after the version exists: `npx storeship preview upload <version> out.mp4 --device iphone69 --locale en-US`.

## 6. Create the version, push metadata and media

```bash
npx storeship version create 1.0.0                     # or --date 2026-10-01 for a scheduled release
npx storeship listing diff 1.0.0                       # what differs; nothing written
npx storeship listing push 1.0.0
npx storeship shots upload 1.0.0
npx storeship preview upload 1.0.0 out.mp4 --device iphone69 --locale en-US
```

Write What's New per locale into `<whatsNew.dir>/1.0.0/<locale>.txt` (App Store Connect shows the field from the second version on, but the files do no harm on the first).

## 7. Build, upload, attach, submit

```bash
npx storeship release 1.0.0 --date 2026-10-01
```

It prints the plan and asks once, then: preflight → `xcodebuild archive` → `xcodebuild -exportArchive` (never with the API key: that switches Xcode to cloud signing and fails with a misleading "no distribution certificate" message) → `altool --upload-app` (with the key) → create the version if missing → write What's New → wait for the build to finish processing (usually 5–20 minutes) and attach it → submit for review.

Every step is idempotent. If it fails, read the hint under the error, fix, and run the same command again. If you uploaded the build another way (Xcode Organizer, CI), add `--no-ship` (and `--build <N>` to name it). To stop before review, `--no-submit`, then `npx storeship version submit 1.0.0` later.

Two resume points worth knowing before you need them:

- **Export failed after a good archive** (typically `No Accounts`: Xcode has no Apple ID signed in — Xcode → Settings → Accounts). Sign in, then `npx storeship release 1.0.0 --date … --archive "<path>.xcarchive"`. `doctor` checks the account up front so this normally never happens.
- **Attach refused with a 409** right after upload: the new build takes minutes to appear in the list and the tool waits for the number it just built. If you attach by hand, name it: `npx storeship version attach 1.0.0 --build <N> --wait`.

If an agent runs this for you, give it a permission rule once (see README → For agents); otherwise the one big `release` command tends to get refused while each of its steps would be allowed.

## 8. After submitting

- `npx storeship version status` shows the state; `builds` the builds.
- While the version is *Waiting for Review* / *In Review*, name, subtitle, keywords, description and media are read-only. **Promotional text is the one field you can change any time.**
- To change the rest, you must withdraw: `npx storeship version cancel --yes`. That forfeits the queue position, and whether a re-submit is accepted is only known when you try (account-level checks run at submit time). Submit first and only cancel if you must.
- With `--date`, the app goes live on that day once approved. Leave review time before it.

## The next release

1. Bump `version` and `ios.buildNumber` in `app.config.*`, `npx expo prebuild`.
2. Write `<whatsNew.dir>/<version>/<locale>.txt`.
3. Re-render only the screenshots that changed; `shots upload <version>` sends only new files (sets are inherited from the previous version).
4. `npx storeship release <version> --date …`.

## Also in the box

- `offer new --name … --codes 500` creates subscription offer codes and downloads the CSV (there is no UI for this in App Store Connect).
- `reel make take.mov out.mp4` composes a vertical social video with your copy on a card.
- `skill install` copies Claude Code skills into `.claude/skills/`, so an agent can run all of the above with the judgement calls left to you.
