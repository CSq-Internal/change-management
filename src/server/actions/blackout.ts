// src/server/actions/blackout.ts
import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"

type BlackoutRecord = { id: string; opcoId: string | null; startsAt: Date; endsAt: Date }

export function isInBlackout(blackouts: BlackoutRecord[], date: Date): boolean {
  return blackouts.some((b) => date >= b.startsAt && date <= b.endsAt)
}

export async function getActiveBlackouts(opcoSlug: string) {
  "use server"
  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: opcoSlug } })
  if (!opco) return []
  const now = new Date()
  return db.blackoutPeriod.findMany({
    where: {
      startsAt: { lte: now }, endsAt: { gte: now },
      OR: [{ opcoId: opco.id }, { opcoId: null }],
    },
  })
}

export async function createBlackoutPeriod(input: {
  opcoSlug: string | null
  label: string
  startsAt: Date
  endsAt: Date
}) {
  "use server"
  const session = await getAppSession()
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { keycloakId: session.keycloakId } })
  if (!user) throw new Error("User not found")

  const opco = input.opcoSlug
    ? await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
    : null

  return db.blackoutPeriod.create({
    data: {
      opcoId: opco?.id ?? null,
      label: input.label,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdById: user.id,
    },
  })
}
