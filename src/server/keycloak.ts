// src/server/keycloak.ts
// Keycloak Admin API helpers (server-only).
//
// Admin auth uses a realm-scoped service account (client_credentials grant) —
// NOT a master-realm admin login. The service account client needs the
// `realm-management` role `manage-users` on the target realm (the only hard
// requirement). Organization sync (createKeycloakOrg / assignToOrganization) is
// best-effort: it needs `manage-organizations`, which on Keycloak 26.6 is not
// seeded by enabling Organizations and can't be hand-grafted — callers catch the
// failure and continue. The realm name is derived from KEYCLOAK_ISSUER (or
// overridden with KEYCLOAK_REALM), so the app is not hardwired to "csquared".

/** Derive the Keycloak base URL + realm from KEYCLOAK_ISSUER (+ optional KEYCLOAK_REALM override). */
function kcEndpoints(): { tokenUrl: string; adminRealmUrl: string } {
  const issuer = process.env.KEYCLOAK_ISSUER
  if (!issuer) throw new Error("KEYCLOAK_ISSUER must be set")
  const match = issuer.match(/^(.*)\/realms\/([^/]+)\/?$/)
  if (!match) {
    throw new Error(
      `KEYCLOAK_ISSUER is not in the expected '<base>/realms/<realm>' form: ${issuer}`
    )
  }
  const base = match[1]
  const realm = process.env.KEYCLOAK_REALM ?? match[2]
  return {
    tokenUrl: `${base}/realms/${realm}/protocol/openid-connect/token`,
    adminRealmUrl: `${base}/admin/realms/${realm}`,
  }
}

export async function getAdminToken(): Promise<string> {
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "csquared-cms-admin"
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
  if (!clientSecret) {
    throw new Error(
      "KEYCLOAK_ADMIN_CLIENT_SECRET must be set for Keycloak admin operations"
    )
  }

  const { tokenUrl } = kcEndpoints()
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
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
  const { adminRealmUrl } = kcEndpoints()
  const [firstName, ...rest] = name.trim().split(" ")
  const lastName = rest.join(" ") || ""

  const res = await fetch(`${adminRealmUrl}/users`, {
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
    if (res.status === 409) {
      const existingId = await findKeycloakUserByEmailWithToken(email, token, adminRealmUrl)
      if (existingId) return existingId
    }
    throw new Error(`Failed to create Keycloak user: ${res.status} ${await res.text()}`)
  }

  // 201 Created — new user id is in Location header
  const location = res.headers.get("Location")
  if (!location) throw new Error("No Location header in Keycloak create-user response")
  const id = location.split("/").at(-1)
  if (!id) throw new Error(`Could not parse user id from Location: ${location}`)
  return id
}

type KeycloakUserSearchResult = {
  id?: string
  email?: string
  username?: string
}

async function findKeycloakUserByEmailWithToken(
  email: string,
  token: string,
  adminRealmUrl: string
): Promise<string | null> {
  const res = await fetch(
    `${adminRealmUrl}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new Error(`Failed to find Keycloak user by email: ${res.status} ${await res.text()}`)
  }

  const users = await res.json()
  if (!Array.isArray(users)) return null

  const normalized = email.toLowerCase()
  const user = users.find((u: KeycloakUserSearchResult) => {
    return (
      u.id &&
      (u.email?.toLowerCase() === normalized || u.username?.toLowerCase() === normalized)
    )
  })

  return user?.id ?? null
}

export async function findKeycloakUserByEmail(email: string): Promise<string | null> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()
  return findKeycloakUserByEmailWithToken(email, token, adminRealmUrl)
}

export async function assignToOrganization(
  keycloakUserId: string,
  orgAlias: string
): Promise<void> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()

  // Look up the org by alias
  const searchRes = await fetch(
    `${adminRealmUrl}/organizations?search=${encodeURIComponent(orgAlias)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!searchRes.ok) {
    throw new Error(`Org search failed: ${searchRes.status}`)
  }
  const orgs = await searchRes.json()
  const org = Array.isArray(orgs) ? orgs.find((o: { alias: string }) => o.alias === orgAlias) : null
  if (!org) throw new Error(`Org not found for alias: ${orgAlias}`)

  const addRes = await fetch(
    `${adminRealmUrl}/organizations/${org.id}/members`,
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
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(
    `${adminRealmUrl}/users/${keycloakUserId}`,
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
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(
    `${adminRealmUrl}/users/${keycloakUserId}`,
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

export async function createKeycloakOrg(slug: string, name: string): Promise<string> {
  const token = await getAdminToken()
  const { adminRealmUrl } = kcEndpoints()
  const res = await fetch(`${adminRealmUrl}/organizations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      alias: slug,
      domains: [{ name: `${slug}.csquared.local`, verified: false }],
    }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create Keycloak org: ${res.status} ${await res.text()}`)
  }
  const location = res.headers.get("Location")
  if (!location) throw new Error("No Location header in Keycloak create-org response")
  const id = location.split("/").at(-1)
  if (!id) throw new Error(`Could not parse org id from Location: ${location}`)
  return id
}
