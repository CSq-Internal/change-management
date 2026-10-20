// A production build strips a server action's error message before it reaches the browser,
// but keeps the error's digest. A UserError puts its message there, so users can read it.
// shortcut: relies on Next 16 passing a preset digest through; recheck on a Next major upgrade.
const PREFIX = "USER_ERROR:"

export class UserError extends Error {
  digest: string
  constructor(message: string) {
    super(message)
    this.name = "UserError"
    this.digest = PREFIX + message
  }
}

/** The text to show for a caught error: a UserError's message, else `fallback` for other server errors. */
export function errorMessage(err: unknown, fallback: string): string {
  const digest = (err as { digest?: unknown } | null)?.digest
  if (typeof digest === "string") return digest.startsWith(PREFIX) ? digest.slice(PREFIX.length) : fallback
  return err instanceof Error ? err.message : fallback
}
