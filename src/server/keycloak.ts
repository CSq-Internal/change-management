// src/server/keycloak.ts
// Keycloak Admin API helpers (server-only)

const KC_BASE = process.env.KEYCLOAK_ISSUER!.replace("/realms/csquared", "")
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USERNAME ?? "admin"
const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin"

export async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${KC_BASE}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: ADMIN_USER,
        password: ADMIN_PASS,
      }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to obtain admin token: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error("No access_token in admin token response")
  return data.access_token as string
}

export async function createKeycloakUser(
  email: string,
  name: string,
  tempPassword: string
): Promise<string> {
  const token = await getAdminToken()
  const [firstName, ...rest] = name.trim().split(" ")
  const lastName = rest.join(" ") || ""

  const res = await fetch(`${KC_BASE}/admin/realms/csquared/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      username: email,
      email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: true,
      credentials: [{ type: "password", value: tempPassword, temporary: true }],
    }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create Keycloak user: ${res.status} ${await res.text()}`)
  }

  // 201 Created — new user id is in Location header
  const location = res.headers.get("Location")
  if (!location) throw new Error("No Location header in Keycloak create-user response")
  const id = location.split("/").at(-1)
  if (!id) throw new Error(`Could not parse user id from Location: ${location}`)
  return id
}

export async function assignToOrganization(
  keycloakUserId: string,
  orgAlias: string
): Promise<void> {
  const token = await getAdminToken()

  // Look up the org by alias
  const searchRes = await fetch(
    `${KC_BASE}/admin/realms/csquared/organizations?search=${encodeURIComponent(orgAlias)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!searchRes.ok) {
    throw new Error(`Org search failed: ${searchRes.status}`)
  }
  const orgs = await searchRes.json()
  const org = Array.isArray(orgs) ? orgs.find((o: { alias: string }) => o.alias === orgAlias) : null
  if (!org) throw new Error(`Org not found for alias: ${orgAlias}`)

  const addRes = await fetch(
    `${KC_BASE}/admin/realms/csquared/organizations/${org.id}/members`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: keycloakUserId }),
    }
  )
  if (!addRes.ok) {
    throw new Error(`Org member add failed: ${addRes.status} ${await addRes.text()}`)
  }
}

export async function deactivateKeycloakUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const res = await fetch(
    `${KC_BASE}/admin/realms/csquared/users/${keycloakUserId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: false }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to deactivate Keycloak user: ${res.status} ${await res.text()}`)
  }
}

export async function reactivateKeycloakUser(keycloakUserId: string): Promise<void> {
  const token = await getAdminToken()
  const res = await fetch(
    `${KC_BASE}/admin/realms/csquared/users/${keycloakUserId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: true }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to reactivate Keycloak user: ${res.status} ${await res.text()}`)
  }
}
