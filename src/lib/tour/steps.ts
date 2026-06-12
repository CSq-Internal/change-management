import type { DriveStep } from "driver.js"
import { t, type Language } from "@/lib/i18n"

export interface TourContext {
  language: Language
  isAdmin: boolean
  isGroupAdmin: boolean
}

function step(language: Language, element: string | undefined, titleKey: string, descKey: string): DriveStep {
  return {
    element,
    popover: { title: t(language, titleKey), description: t(language, descKey) },
  }
}

/** Ordered, role-filtered driver.js steps. Targets are `data-tour` attributes on AppShell. */
export function buildTourSteps({ language, isAdmin, isGroupAdmin }: TourContext): DriveStep[] {
  const steps: DriveStep[] = [
    step(language, undefined, "tour.welcome.title", "tour.welcome.desc"),
    step(language, '[data-tour="nav-dashboard"]', "tour.dashboard.title", "tour.dashboard.desc"),
    step(language, '[data-tour="nav-requests"]', "tour.requests.title", "tour.requests.desc"),
    step(language, '[data-tour="nav-approvals"]', "tour.approvals.title", "tour.approvals.desc"),
    step(language, '[data-tour="nav-changes"]', "tour.changes.title", "tour.changes.desc"),
    step(language, '[data-tour="nav-calendar"]', "tour.calendar.title", "tour.calendar.desc"),
    step(language, '[data-tour="tour-notifications"]', "tour.notifications.title", "tour.notifications.desc"),
  ]

  if (isAdmin) {
    steps.push(
      step(language, '[data-tour="nav-users"]', "tour.users.title", "tour.users.desc"),
      step(language, '[data-tour="nav-cab"]', "tour.cab.title", "tour.cab.desc"),
      step(language, '[data-tour="nav-approval-matrix"]', "tour.approvalMatrix.title", "tour.approvalMatrix.desc"),
    )
  }
  if (isGroupAdmin) {
    steps.push(step(language, '[data-tour="nav-opcos"]', "tour.opcos.title", "tour.opcos.desc"))
  }

  steps.push(step(language, '[data-tour="tour-help"]', "tour.helpStep.title", "tour.helpStep.desc"))
  return steps
}
