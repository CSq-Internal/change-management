import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Production builds hide a plain Error's message from the browser; actions throw UserError,
// whose message survives. A plain `throw new Error(` here would show users a generic text.
describe("server actions", () => {
  const dir = join(process.cwd(), "src/server/actions")
  const files = [...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)),
    join(process.cwd(), "src/server/documents.ts"), join(process.cwd(), "src/lib/feedback-outcome.ts")]

  it.each(files)("%s throws only UserError", (file) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths come from the repo listing above
    expect(readFileSync(file, "utf8")).not.toMatch(/throw new Error\(/)
  })
})
