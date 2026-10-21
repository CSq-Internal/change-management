import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const realm = JSON.parse(readFileSync("docker/keycloak/realms/csquared-realm.json", "utf8"))
const cms = realm.clients.find((c: { clientId: string }) => c.clientId === "csquared-cms")

describe("local realm", () => {
  it("defines no CMS group roles in Keycloak", () => {
    expect(realm.roles?.client?.["csquared-cms"]).toBeUndefined()
    expect(cms.protocolMappers ?? []).not.toContainEqual(expect.objectContaining({ protocolMapper: "oidc-usermodel-client-role-mapper" }))
    for (const u of realm.users) expect(u.clientRoles?.["csquared-cms"]).toBeUndefined()
  })

  it("keeps the admin service account able to provision users", () => {
    const sa = realm.users.find((u: { username: string }) => u.username === "service-account-csquared-cms-admin")
    expect(sa.clientRoles["realm-management"]).toContain("manage-users")
  })
})
