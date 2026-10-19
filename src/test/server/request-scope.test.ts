import { describe, it, expect } from "vitest"
import { requestScope, openOrRecent } from "@/server/request-scope"

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
    expect(where).toEqual({
      OR: [{ opco: { slug: { in: ["ghana", "uganda"] } } }, { requester: { keycloakId: "kc-1" } }],
    })
  })
  it("opco approver still sees their own requests in an OpCo where they are only a requester", () => {
    const where = requestScope(user([{ alias: "ghana", roles: ["approver"] }, { alias: "nigeria", roles: ["requester"] }], []))
    expect(where).toEqual({
      OR: [{ opco: { slug: { in: ["ghana"] } } }, { requester: { keycloakId: "kc-1" } }],
    })
  })
  it("member → own requests by requester keycloakId", () => {
    expect(requestScope(user([{ alias: "ghana", roles: ["requester"] }], []))).toEqual({
      requester: { keycloakId: "kc-1" },
    })
  })
})

describe("openOrRecent", () => {
  it("keeps every open change and only the last 90 days of finished ones", () => {
    const now = Date.parse("2026-10-17T00:00:00Z")
    expect(openOrRecent(now)).toEqual({
      OR: [
        { status: { notIn: ["closed", "rejected", "cancelled"] } },
        { updatedAt: { gte: new Date("2026-07-19T00:00:00Z") } },
      ],
    })
  })
})
