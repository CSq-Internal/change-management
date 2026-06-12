"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { driver, type Driver } from "driver.js"
import "driver.js/dist/driver.css"
import { useStore } from "@/lib/store"
import { canManageAnyOpCo, isGroupAdmin } from "@/lib/permissions"
import { buildTourSteps } from "@/lib/tour/steps"
import { t } from "@/lib/i18n"

const SEEN_KEY = "csq-tour-seen"
const START_EVENT = "csq:start-tour"
const DESKTOP_QUERY = "(min-width: 1024px)" // matches AppShell `lg` sidebar visibility

export default function ProductTour() {
  const { data: session } = useSession()
  const { language } = useStore()
  const driverRef = useRef<Driver | null>(null)

  useEffect(() => {
    const user = session?.user
    if (!user) return

    const isAdmin = canManageAnyOpCo(user.organizations, user.realmRoles)
    const groupAdmin = isGroupAdmin(user.realmRoles)

    function start() {
      driverRef.current?.destroy()
      const steps = buildTourSteps({ language, isAdmin, isGroupAdmin: groupAdmin }).filter(
        (s) => !s.element || document.querySelector(s.element as string),
      )
      if (steps.length === 0) return
      const d = driver({
        showProgress: true,
        popoverClass: "csq-tour",
        nextBtnText: t(language, "tour.next"),
        prevBtnText: t(language, "tour.prev"),
        doneBtnText: t(language, "tour.done"),
        steps,
        onDestroyed: () => {
          driverRef.current = null
        },
      })
      driverRef.current = d
      d.drive()
    }

    const onStart = () => start()
    window.addEventListener(START_EVENT, onStart)

    if (!localStorage.getItem(SEEN_KEY) && window.matchMedia(DESKTOP_QUERY).matches) {
      localStorage.setItem(SEEN_KEY, "1")
      start()
    }

    // Intentionally do NOT destroy the tour on cleanup. React Strict Mode (dev)
    // double-invokes effects (run → cleanup → run); destroying here would tear down
    // the auto-started tour before it's seen, and the seen-flag would already be set
    // so it wouldn't restart. ProductTour lives in AppShell for the whole authenticated
    // session, so there is no real mid-tour unmount to clean up.
    return () => {
      window.removeEventListener(START_EVENT, onStart)
    }
  }, [session, language])

  return null
}
