import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const serverActions = import.meta.glob("/src/server/actions/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>

// Every action string a server file passes to recordAdminAction, ternaries included.
function writtenActions(): Set<string> {
  const found = new Set<string>()
  for (const src of Object.values(serverActions)) {
    if (!src.includes("recordAdminAction")) continue
    for (const line of src.matchAll(/action: ([^,}\n]+)/g)) {
      for (const lit of line[1].matchAll(/"([a-z_.]+)"/g)) found.add(lit[1])
    }
  }
  return found
}

describe("admin audit action filter", () => {
  it("offers exactly the actions the server records", () => {
    const client = readFileSync("src/app/(dashboard)/admin-audit/audit-client.tsx", "utf8")
    const list = client.match(/const ACTIONS = \[([\s\S]*?)\]/)![1]
    const offered = new Set([...list.matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]))
    expect([...offered].sort()).toEqual([...writtenActions()].sort())
  })
})
