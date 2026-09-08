import { readFileSync } from 'node:fs'
import { type Command } from '../ctx.ts'
import { StoreshipError, UsageError } from '../errors.ts'
import { renderCommandDocs, type Lang } from '../docs/render.ts'
import { registry } from '../registry.ts'

export { registry }

export const docsCommand: Command = {
  name: 'docs',
  summary: 'generate the command reference (Markdown) from the command tree; --check compares with a file',
  impact: 'read',
  usage: 'docs [--lang en|zh] [--check FILE]',
  flags: { lang: 'en (default) or zh', check: 'compare with this file and exit 3 when it differs (for CI)' },
  run: async (ctx) => {
    const lang = (ctx.args.str('lang') ?? 'en') as Lang
    if (lang !== 'en' && lang !== 'zh') throw new UsageError('--lang must be en or zh')
    const md = renderCommandDocs(registry.commands, registry.globalFlags, lang)
    const check = ctx.args.str('check')
    if (check) {
      const have = readFileSync(check, 'utf8')
      if (have !== md) throw new StoreshipError(`${check} is out of date`, `regenerate it: storeship docs --lang ${lang} > ${check}`, { code: 'CHECK_FAILED' })
      ctx.out.emit({ file: check, upToDate: true })
      ctx.out.log(`${check} is up to date`)
      return
    }
    // The markdown is the point in human mode, and noise in an agent's context:
    // --json says how big it is, --raw hands it over.
    if (ctx.out.json) ctx.out.emit({ lang, bytes: md.length }, { lang, markdown: md })
    else process.stdout.write(md)
  },
}
