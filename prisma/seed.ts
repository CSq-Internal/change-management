import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL must be set to run the seed.')
}

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const opcos = [
  { slug: 'ghana',     name: 'CSquared Ghana',     locale: 'en', keycloakOrgId: 'org-ghana' },
  { slug: 'uganda',    name: 'CSquared Uganda',    locale: 'en', keycloakOrgId: 'org-uganda' },
  { slug: 'drc',       name: 'CSquared DRC',       locale: 'fr', keycloakOrgId: 'org-drc' },
  { slug: 'togo',      name: 'CSquared Togo',      locale: 'fr', keycloakOrgId: 'org-togo' },
  { slug: 'liberia',   name: 'CSquared Liberia',   locale: 'en', keycloakOrgId: 'org-liberia' },
  { slug: 'mauritius', name: 'CSquared Mauritius', locale: 'en', keycloakOrgId: 'org-mauritius' },
]

async function main() {
  for (const o of opcos) {
    await prisma.opCo.upsert({ where: { slug: o.slug }, update: {}, create: o })
  }
  console.log('Seeded 6 OpCos')

  await prisma.user.upsert({
    where: { email: 'devops@csquared.com' },
    update: {},
    create: { keycloakId: 'REPLACE_WITH_KEYCLOAK_SUB', email: 'devops@csquared.com', name: 'Dev Admin' },
  })
  console.log('Seeded dev admin user')

  const ghana = await prisma.opCo.findUnique({ where: { slug: 'ghana' } })
  const admin = await prisma.user.findUnique({ where: { email: 'devops@csquared.com' } })
  if (ghana && admin) {
    await prisma.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: admin.id, opcoId: ghana.id } },
      update: { role: 'admin', isActive: true },
      create: { userId: admin.id, opcoId: ghana.id, role: 'admin', isActive: true },
    })
    console.log('Seeded devops -> ghana (admin) OpCo assignment')

    const requester = await prisma.user.upsert({
      where: { email: 'requester@csquared.com' },
      update: { name: 'Demo Requester' },
      create: { keycloakId: 'seed-demo-requester', email: 'requester@csquared.com', name: 'Demo Requester' },
    })

    await prisma.changeRequest.upsert({
      where: { id: 'seed-cr-001' },
      update: {
        requesterId: requester.id,
        status: 'pending',
        riskLevel: 'medium',
        infrastructureType: 'Backbone IP Network',
      },
      create: {
        id: 'seed-cr-001',
        opcoId: ghana.id,
        requesterId: requester.id,
        title: 'Backbone IP route table update',
        description: 'Update BGP route table for new peering arrangement',
        category: 'config',
        riskLevel: 'medium',
        status: 'pending',
        contactEmail: 'devops@csquared.com',
        infrastructureType: 'Backbone IP Network',
      },
    })
    console.log('Seeded 1 sample change request')
  }

  // Group CTO — approves Equiano (group-level) infra; secondee on all other infra.
  await prisma.user.upsert({
    where: { email: 'samuel.yeboah@csquared.com' },
    update: { isGroupCto: true, name: 'Samuel Yeboah' },
    create: { keycloakId: 'seed-samuel-yeboah', email: 'samuel.yeboah@csquared.com', name: 'Samuel Yeboah', isGroupCto: true },
  })
  console.log('Seeded Group CTO: Samuel Yeboah')

  // Resident CTO (approver role) for each OpCo.
  const residentCtoNames: Record<string, string> = {
    ghana: 'Ama Owusu', uganda: 'David Okello', drc: 'Céline Mbiya',
    togo: 'Kossi Adjavon', liberia: 'Joseph Kollie', mauritius: 'Priya Ramphul',
  }
  for (const o of opcos) {
    const opco = await prisma.opCo.findUnique({ where: { slug: o.slug } })
    if (!opco) continue
    const cto = await prisma.user.upsert({
      where: { email: `${o.slug}.cto@csquared.com` },
      update: { name: residentCtoNames[o.slug] },
      create: { keycloakId: `seed-${o.slug}-cto`, email: `${o.slug}.cto@csquared.com`, name: residentCtoNames[o.slug] },
    })
    await prisma.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: cto.id, opcoId: opco.id } },
      update: { role: 'approver', isActive: true },
      create: { userId: cto.id, opcoId: opco.id, role: 'approver', isActive: true },
    })
  }
  console.log('Seeded resident CTOs (approver) for all OpCos')
}

main().catch(console.error).finally(() => prisma.$disconnect())
