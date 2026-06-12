import SecurityClient from "./security-client"

export default function SecuritySettingsPage() {
  const issuer = process.env.KEYCLOAK_ISSUER
  const accountUrl = issuer ? `${issuer.replace(/\/$/, "")}/account` : null
  return <SecurityClient accountUrl={accountUrl} />
}
