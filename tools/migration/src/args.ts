// Tiny, dependency-free CLI argument parser. Supports:
//   --flag            -> { flag: true }
//   --key value       -> { key: "value" }
//   --key=value       -> { key: "value" }

export interface ParsedArgs {
  [key: string]: string | boolean | undefined
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[body] = next
      i++
    } else {
      out[body] = true
    }
  }
  return out
}

export function getString(args: ParsedArgs, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

export function getFlag(args: ParsedArgs, key: string): boolean {
  return args[key] === true || args[key] === 'true'
}
