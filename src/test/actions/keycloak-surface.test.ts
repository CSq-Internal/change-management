import { describe, it, expect } from "vitest"
import * as kc from "@/server/keycloak"

describe("Keycloak admin surface", () => {
  it("keeps account provisioning and drops the Organizations mirror", () => {
    expect(Object.keys(kc).sort()).toEqual(["createOrFindKeycloakUser", "getAdminToken", "verifyAdoptedKeycloakUser"])
  })
})
