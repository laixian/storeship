# Store listing as code

The six metadata fields and the App Review information live in one Markdown file, are diffed against App Store Connect, and only the differences are written. Commands: `storeship listing check | diff | push`.

[← README](../README.md) · [command reference](commands.md) · [configuration](config.md) · [for agents](agents.md)

`listing.md` is the source of truth for the six metadata fields and the App Review information. `listing diff` shows what differs; `listing push` writes only that.

```markdown
# Store listing

## en-US
### name
My App
### subtitle
Does the thing
### keywords
a,b,c
### description
```
Several paragraphs. A fenced block is taken verbatim,
so `#` and `---` inside it are safe.
```
### promotionalText
Optional.

## zh-Hans
### name
…
```

Rules: a `##` heading that looks like a locale code opens a locale; other `##` sections are prose and ignored. Field headings are the ASC attribute names. Fields you leave out are left alone in ASC. Limits are checked before anything is written (30 / 30 / 100 / 4000 / 170, CJK counts as one).

What's New lives in `<whatsNew.dir>/<version>/<locale>.txt`, or is passed with `--file en-US=path`.

## App Review information

What App Review asks for after "Waiting for Review" — the notes, a contact, a demo account — lives in the same file under `## review` (one record per version; ASC copies the previous version's, so the diff is usually empty):

```markdown
## review
### notes
```
No sign-in needed. Home → Charts → pick a song → play.
Local Network is only for the optional multi-device mode…
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

The demo password is never in the file: set `ASC_DEMO_PASSWORD` and it is written on every push (the API never reads it back, so it cannot be diffed). Notes are limited to 4000 characters, checked offline by `listing check`.
