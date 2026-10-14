// ChangeRequest ids are Prisma cuid()s: "c" + 24 lowercase base-36 chars.
export const CHANGE_ID_RE = /^c[a-z0-9]{24}$/

/**
 * The change on screen, for the feedback context snapshot: the [id] segment of
 * /changes/[id](/...) when it looks like a real change id, else null — so the server's
 * validation never rejects a report because of a route that is not a change.
 */
export function changeIdFromPath(pathname: string): string | null {
  const match = /^\/changes\/([^/]+)/.exec(pathname)
  return match && CHANGE_ID_RE.test(match[1]) ? match[1] : null
}
