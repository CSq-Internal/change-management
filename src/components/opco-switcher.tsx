// src/components/opco-switcher.tsx
"use client"

import { useSession } from "next-auth/react"
import { getUserOpCos, OPCO_NAMES, OPCO_SLUGS } from "@/lib/opco"
import { isGroupAdmin } from "@/lib/permissions"
import { useMemo } from "react"

// Stores active OpCo in a cookie; server components read it from request headers
function setActiveOpCo(slug: string) {
  document.cookie = `csq-active-opco=${slug}; path=/; max-age=86400`
  window.location.reload()
}

export function OpCoSwitcher() {
  const { data: session } = useSession()

  const userIsGroupAdmin = session ? isGroupAdmin(session.user.realmRoles) : false
  const userOpCos = useMemo(() => session ? getUserOpCos(session.user.organizations) : [], [session])

  const options = useMemo(() => {
    if (userIsGroupAdmin) {
      return [
        { value: "all", label: "All OpCos" },
        ...OPCO_SLUGS.map((s) => ({ value: s, label: OPCO_NAMES[s] })),
      ]
    }
    return userOpCos.map((s) => ({ value: s, label: OPCO_NAMES[s] }))
  }, [userIsGroupAdmin, userOpCos])

  if (!session) return null
  if (options.length <= 1) return null

  return (
    <select
      defaultValue={userOpCos[0] ?? "all"}
      onChange={(e) => setActiveOpCo(e.target.value)}
      className="rounded border bg-background px-2 py-1 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
