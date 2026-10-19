import * as dotenv from 'dotenv'

dotenv.config()

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    )
  }
  return v.trim()
}

export function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v.trim() : fallback
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v == null || v.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(v.trim())
}
