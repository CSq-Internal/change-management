import { describe, it, expect } from "vitest"
import { requestScope } from "@/server/request-scope"

const user = (orgs: { alias: string; roles: string[] }[], realmRoles: string[]) => ({
  keycloakId: "kc-1",
  organizations: orgs.map((o, i) => ({ id: `o${i}`, name: o.alias, alias: o.alias, roles: o.roles })),
  realmRoles,
})

describe("requestScope", () => {
  it("group → empty where (all changes)", () => {
    expect(requestScope(user([], ["group_admin"]))).toEqual({})
  })
  it("opco admin/approver → scoped by opco slug", () => {
    const where = requestScope(user([{ alias: "ghana", roles: ["approver"] }, { alias: "uganda", roles: ["admin"] }], []))
    expect(where).toEqual({ opco: { slug: { in: ["ghana", "uganda"] } } })
  })
  it("member → own requests by requester keycloakId", () => {
    expect(requestScope(user([{ alias: "ghana", roles: ["requester"] }], []))).toEqual({
      requester: { keycloakId: "kc-1" },
    })
  })
})
