// src/server/actions/teams.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageTeams } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import type { SessionOrganization } from "@/types/next-auth"

type Session = { keycloakId: string; organizations: SessionOrganization[]; realmRoles: string[] }

function assertCanManageTeams(session: Session, opcoSlug: string) {
  if (!canManageTeams(session.organizations, session.realmRoles, opcoSlug)) {
    throw new Error(`Forbidden: cannot manage teams in ${opcoSlug}`)
  }
}

// Resolves a team's OpCo (id + slug); throws if the team is missing.
async function loadTeamOpco(
  db: ReturnType<typeof getPrisma>,
  teamId: string
): Promise<{ opcoId: string; opcoSlug: string }> {
  const team = await db.team.findUnique({ where: { id: teamId }, include: { opco: true } })
  if (!team) throw new Error("Team not found")
  return { opcoId: team.opcoId, opcoSlug: team.opco.slug }
}

export async function createTeam(input: { opcoSlug: string; name: string; description?: string }) {
  const session = await getAppSession()
  assertCanManageTeams(session, input.opcoSlug)

  const db = getPrisma()
  const opco = await db.opCo.findUnique({ where: { slug: input.opcoSlug } })
  if (!opco) throw new Error(`OpCo not found: ${input.opcoSlug}`)

  return db.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { opcoId: opco.id, name: input.name, description: input.description ?? null },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.create",
      opcoId: opco.id,
      summary: `Created team "${input.name}" in ${input.opcoSlug}`,
    })
    return team
  })
}

export async function updateTeam(teamId: string, data: { name?: string; description?: string }) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  return db.$transaction(async (tx) => {
    const team = await tx.team.update({ where: { id: teamId }, data })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.update",
      opcoId,
      summary: `Updated team ${teamId}`,
      metadata: data,
    })
    return team
  })
}

export async function deleteTeam(teamId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)

  await db.$transaction(async (tx) => {
    await tx.teamMember.deleteMany({ where: { teamId } })
    await tx.team.delete({ where: { id: teamId } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.delete",
      opcoId,
      summary: `Deleted team ${teamId}`,
    })
  })
}
