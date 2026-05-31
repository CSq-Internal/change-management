// src/lib/opco.ts
import type { SessionOrganization } from "@/types/next-auth"

export const OPCO_SLUGS = ["ghana", "uganda", "drc", "togo", "liberia", "mauritius"] as const
export type OpCoSlug = typeof OPCO_SLUGS[number]

export const OPCO_NAMES: Record<OpCoSlug, string> = {
  ghana: "CSquared Ghana",
  uganda: "CSquared Uganda",
  drc: "CSquared DRC",
  togo: "CSquared Togo",
  liberia: "CSquared Liberia",
  mauritius: "CSquared Mauritius",
}

export function getUserOpCos(organizations: SessionOrganization[]): OpCoSlug[] {
  return organizations
    .map((o) => o.alias as OpCoSlug)
    .filter((s) => (OPCO_SLUGS as readonly string[]).includes(s))
}
