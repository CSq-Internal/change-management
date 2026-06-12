import { test, expect } from "vitest"
import { resolveTheme, THEME_STORAGE_KEY } from "./theme"

test("resolveTheme returns the explicit choice for light/dark", () => {
  expect(resolveTheme("light", true)).toBe("light")
  expect(resolveTheme("light", false)).toBe("light")
  expect(resolveTheme("dark", false)).toBe("dark")
  expect(resolveTheme("dark", true)).toBe("dark")
})

test("resolveTheme follows the OS preference for system", () => {
  expect(resolveTheme("system", true)).toBe("dark")
  expect(resolveTheme("system", false)).toBe("light")
})

test("THEME_STORAGE_KEY matches the persisted localStorage key", () => {
  expect(THEME_STORAGE_KEY).toBe("csq-theme")
})
