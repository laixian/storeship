import { readFileSync } from 'node:fs'
import { type Command } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'
import { renderCommandDocs, type Lang } from '../docs/render.ts'

/** Filled in by cli.ts to avoid an import cycle. */
export const registry: { commands: Command[]; globalFlags: Record<string, string> } = { commands: [], globalFlags: {} }

export const docsCommand: Command = {
  name: 'docs',
  summary: 'generate the command reference (Markdown) from the command tree; --check compares with a file',
  usage: 'docs [--lang en|zh] [--check FILE]',
  flags: { lang: 'en (default) or zh', check: 'compare with this file and exit 1 when it differs (for CI)' },
  run: async (ctx) => {
    const lang = (ctx.args.str('lang') ?? 'en') as Lang
    if (lang !== 'en' && lang !== 'zh') throw new UsageError('--lang must be en or zh')
    const md = renderCommandDocs(registry.commands, registry.globalFlags, lang)
    const check = ctx.args.str('check')
    if (check) {
      const have = readFileSync(check, 'utf8')
      if (have !== md) throw new StoreshipError(`${check} is out of date`, `regenerate it: storeship docs --lang ${lang} > ${check}`)
      ctx.out.emit({ file: check, upToDate: true })
      ctx.out.log(`${check} is up to date`)
      return
    }
    if (ctx.out.json) ctx.out.emit({ lang, markdown: md })
    else process.stdout.write(md)
  },
}
