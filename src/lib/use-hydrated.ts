"use client"
import { useSyncExternalStore } from "react"

const noSubscribe = () => () => {}

/**
 * `server` on the server and during hydration, `getClient()` after. For output that
 * depends on the viewer's clock or time zone: the server renders in UTC, and a mismatch
 * breaks hydration. `getClient` must return the same value until it really changes.
 */
export function useClientValue<T>(getClient: () => T, server: T): T {
  return useSyncExternalStore(noSubscribe, getClient, () => server)
}

export const useHydrated = () => useClientValue(() => true, false)
