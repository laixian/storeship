/**
 * Keeping the shipped skills honest.
 *
 * A skill is a procedure with judgement in it — that part is written by hand.
 * The *facts* in it (what the envelope looks like, what the exit codes mean,
 * what an error code means, which commands exist) are code, and a copy of them
 * in prose drifts the moment a command is renamed. So:
 *
 *   - marked blocks are generated from the command tree and the code tables;
 *   - every `storeship …` command a skill mentions must resolve in that tree;
 *   - each file carries the version it was generated for, so a stale copy in a
 *     project can be spotted (`storeship skill check`, and `doctor`).
 */
import { CODES, EXIT_MEANING, type ErrorCode } from '../codes.ts'
import type { Command } from '../ctx.ts'
import { ZH_ABOUT, ZH_EXIT } from '../docs/zh.ts'
import { HINTS } from '../hints.ts'
import { VERSION } from '../meta.ts'

export type Lang = 'en' | 'zh'

export const STAMP = (version: string): string => `<!-- storeship ${version} — generated blocks below are written by \`storeship skill sync\`; do not edit them by hand -->`
const STAMP_RE = /^<!-- storeship (\S+) — generated blocks[^>]*-->$/m

export type Block = 'protocol' | 'errors'
const open = (b: Block): string => `<!-- storeship:${b} -->`
const close = (b: Block): string => `<!-- /storeship:${b} -->`

const T = {
  en: {
    intro: 'Every command takes `--json` and answers with one envelope:',
    ok: '`ok` says whether the command ran, never whether the answer was yes. The exit code says that:',
    head: '| exit | meaning | what to do |',
    tail: [
      'Branch on `error.code`, never on the message. `retry: "never"` means running it again changes nothing.',
      'Read `next` — it is what this tool would do next, and it never contains an irreversible command.',
    ],
    errHead: '| code | exit | retry | what it actually is |',
    errTail: '👤 = only a person can clear it; `error.humanAction` says what to tell them.',
  },
  zh: {
    intro: '每条命令都接受 `--json`，回的都是同一个信封：',
    ok: '`ok` 说的是命令跑没跑成，不是答案是不是「是」。答案由退出码说：',
    head: '| 退出码 | 含义 | 该怎么做 |',
    tail: [
      '**认 `error.code`，不要认 message。** `retry: "never"` 意思是原样再跑一次结果一样。',
      '读 `next`——那是这个工具自己会做的下一步，而且里面永远不会有不可撤销的命令。',
    ],
    errHead: '| 错误码 | 退出码 | 能否重试 | 它到底是什么 |',
    errTail: '👤 = 只有人能解决；`error.humanAction` 就是要转告他们的话。',
  },
}

export function protocolBlock(lang: Lang = 'en'): string {
  const t = T[lang]
  return [
    t.intro,
    '',
    '```json',
    '{ "ok": true, "command": "version attach", "data": {}, "changed": [], "warnings": [], "next": [{ "command": "…", "why": "…", "impact": "write" }] }',
    '{ "ok": false, "error": { "code": "BUILD_NOT_PROCESSED", "message": "…", "hint": "…", "retry": "after-wait", "humanAction": null } }',
    '```',
    '',
    t.ok,
    '',
    t.head,
    '|---|---|---|',
    ...EXIT_MEANING.map((e) => (lang === 'zh' ? `| ${e.code} | ${ZH_EXIT[e.name]!.meaning} | ${ZH_EXIT[e.name]!.agent} |` : `| ${e.code} | ${e.meaning} | ${e.agent} |`)),
    '',
    ...t.tail,
  ].join('\n')
}

export function errorsBlock(lang: Lang = 'en'): string {
  const t = T[lang]
  const rows = (Object.keys(CODES) as ErrorCode[]).map((code) => {
    const h = HINTS.find((x) => x.code === code)
    const about = lang === 'zh' ? (ZH_ABOUT[code] ?? CODES[code].about) : CODES[code].about
    return `| \`${code}\` | ${CODES[code].exit} | ${CODES[code].retry} | ${h?.humanAction ? '👤 ' : ''}${about} |`
  })
  return [t.errHead, '|---|---|---|---|', ...rows, '', t.errTail].join('\n')
}

const BLOCKS: Record<Block, (lang: Lang) => string> = { protocol: protocolBlock, errors: errorsBlock }

/** Replace every marked block, and the version stamp, with what the code says today. */
export function syncSkill(text: string, version = VERSION, lang: Lang = 'en'): string {
  let out = text
  for (const b of Object.keys(BLOCKS) as Block[]) {
    const re = new RegExp(`${open(b)}[\\s\\S]*?${close(b)}`, 'g')
    out = out.replace(re, `${open(b)}\n${BLOCKS[b](lang)}\n${close(b)}`)
  }
  return STAMP_RE.test(out) ? out.replace(STAMP_RE, STAMP(version)) : out
}

/** The version a skill file was generated for, if it carries a stamp. */
export function stampOf(text: string): string | undefined {
  return STAMP_RE.exec(text)?.[1]
}

/** Code spans and fenced blocks — the only places a skill states a command. */
export function codeSnippets(text: string): string[] {
  return [...[...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]), ...[...text.matchAll(/`[^`\n]+`/g)].map((m) => m[0])]
}

/**
 * Every `storeship …` invocation a skill states, as a command path. Prose is
 * ignored on purpose ("storeship defaults it to false" is a sentence, not a
 * command); anything inside backticks is meant literally and has to resolve.
 */
export function mentionedCommands(text: string, tree: Command[]): { path: string; ok: boolean }[] {
  const found = new Map<string, boolean>()
  for (const snippet of codeSnippets(text)) {
    for (const m of snippet.matchAll(/\bstoreship\s+((?:[a-z][a-z-]*\s+){0,2}[a-z][a-z-]*)/g)) {
      const tokens = m[1]!.trim().split(/\s+/)
      let level: Command[] | undefined = tree
      const path: string[] = []
      for (const t of tokens) {
        const hit: Command | undefined = level?.find((c) => c.name === t)
        if (!hit) break
        path.push(t)
        level = hit.sub
      }
      if (path.length) found.set(path.join(' '), true)
      else found.set(tokens[0]!, false)
    }
  }
  return [...found].map(([path, ok]) => ({ path, ok }))
}

export type SkillProblem = { file: string; problem: string }

/** Which language's generated blocks a file wants, from its path. */
export const langOf = (file: string): Lang => (file.includes('/zh/') ? 'zh' : 'en')

/** Everything wrong with a set of skill files: stale blocks, stale stamp, commands that do not exist. */
export function checkSkill(file: string, text: string, tree: Command[], version = VERSION): SkillProblem[] {
  const problems: SkillProblem[] = []
  // A file under docs/zh gets the Chinese tables; everything else the English ones.
  const synced = syncSkill(text, version, langOf(file))
  if (synced !== text) problems.push({ file, problem: 'generated blocks or the version stamp are out of date — run `storeship skill sync`' })
  const stamp = stampOf(text)
  if (!stamp) problems.push({ file, problem: 'no version stamp; add the line `' + STAMP(version) + '`' })
  for (const c of mentionedCommands(text, tree)) if (!c.ok) problems.push({ file, problem: `mentions \`storeship ${c.path}\`, which is not a command` })
  return problems
}
