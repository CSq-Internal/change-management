// src/server/actions/teams.ts
"use server"

import { getPrisma } from "@/server/db"
import { getAppSession } from "@/lib/session"
import { canManageTeams } from "@/lib/permissions"
import { recordAdminAction } from "@/server/audit"
import type { SessionOrganization } from "@/types/next-auth"
import type { TeamRole } from "@prisma/client"

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

// Shared preamble for actions on an existing team: resolves the session and client,
// loads the team's OpCo, and asserts the caller may manage teams there.
async function authorizeTeamAction(teamId: string) {
  const session = await getAppSession()
  const db = getPrisma()
  const { opcoId, opcoSlug } = await loadTeamOpco(db, teamId)
  assertCanManageTeams(session, opcoSlug)
  return { session, db, opcoId }
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
  const { session, db, opcoId } = await authorizeTeamAction(teamId)

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
  const { session, db, opcoId } = await authorizeTeamAction(teamId)

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

export async function addTeamMember(teamId: string, userId: string, role: TeamRole = "member") {
  const { session, db, opcoId } = await authorizeTeamAction(teamId)

  // Eligibility: a team member must hold an active assignment in the team's OpCo.
  const assignment = await db.userOpCoAssignment.findFirst({
    where: { userId, opcoId, isActive: true },
  })
  if (!assignment) throw new Error("Forbidden: user is not assigned to this team's OpCo")

  return db.$transaction(async (tx) => {
    const member = await tx.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      update: { role },
      create: { teamId, userId, role },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.add",
      opcoId,
      targetUserId: userId,
      summary: `Added user ${userId} to team ${teamId} as ${role}`,
    })
    return member
  })
}

export async function removeTeamMember(teamId: string, userId: string) {
  const { session, db, opcoId } = await authorizeTeamAction(teamId)

  await db.$transaction(async (tx) => {
    await tx.teamMember.delete({ where: { teamId_userId: { teamId, userId } } })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.remove",
      opcoId,
      targetUserId: userId,
      summary: `Removed user ${userId} from team ${teamId}`,
    })
  })
}

export async function setTeamMemberRole(teamId: string, userId: string, role: TeamRole) {
  const { session, db, opcoId } = await authorizeTeamAction(teamId)

  return db.$transaction(async (tx) => {
    const member = await tx.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { role },
    })
    await recordAdminAction(tx, {
      actorKeycloakId: session.keycloakId,
      action: "team.member.role",
      opcoId,
      targetUserId: userId,
      summary: `Set user ${userId} role to ${role} in team ${teamId}`,
    })
    return member
  })
}

export async function listOpCoMembers(opcoSlug: string) {
  const session = await getAppSession()
  assertCanManageTeams(session, opcoSlug)
  const db = getPrisma()
  const rows = await db.userOpCoAssignment.findMany({
    where: { opco: { slug: opcoSlug }, isActive: true },
    select: { user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  })
  return rows.map((r) => r.user)
}
