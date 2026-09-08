/**
 * The command tree, filled in by cli.ts at startup.
 *
 * `docs`, `spec` and `skill check` all need the whole tree, and cli.ts is the
 * only place that has it; going through this box avoids an import cycle.
 */
import type { Command } from './ctx.ts'

export const registry: { commands: Command[]; globalFlags: Record<string, string>; globalBooleans: string[] } = {
  commands: [],
  globalFlags: {},
  globalBooleans: [],
}
