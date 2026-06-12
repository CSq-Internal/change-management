import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set to run the seed.');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const opcos = [
  {
    slug: 'ghana',
    name: 'CSquared Ghana',
    locale: 'en',
    keycloakOrgId: 'org-ghana',
  },
  {
    slug: 'uganda',
    name: 'CSquared Uganda',
    locale: 'en',
    keycloakOrgId: 'org-uganda',
  },
  { slug: 'drc', name: 'CSquared DRC', locale: 'fr', keycloakOrgId: 'org-drc' },
  {
    slug: 'togo',
    name: 'CSquared Togo',
    locale: 'fr',
    keycloakOrgId: 'org-togo',
  },
  {
    slug: 'liberia',
    name: 'CSquared Liberia',
    locale: 'en',
    keycloakOrgId: 'org-liberia',
  },
  {
    slug: 'mauritius',
    name: 'CSquared Mauritius',
    locale: 'en',
    keycloakOrgId: 'org-mauritius',
  },
];

async function main() {
  for (const o of opcos) {
    await prisma.opCo.upsert({
      where: { slug: o.slug },
      update: {},
      create: o,
    });
  }
  console.log('Seeded 6 OpCos');

  await prisma.user.upsert({
    where: { email: 'devops@csquared.com' },
    update: {},
    create: {
      keycloakId: 'REPLACE_WITH_KEYCLOAK_SUB',
      email: 'devops@csquared.com',
      name: 'Dev Admin',
    },
  });
  console.log('Seeded dev admin user');

  const ghana = await prisma.opCo.findUnique({ where: { slug: 'ghana' } });
  const admin = await prisma.user.findUnique({
    where: { email: 'devops@csquared.com' },
  });
  if (ghana && admin) {
    await prisma.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: admin.id, opcoId: ghana.id } },
      update: { role: 'admin', isActive: true },
      create: {
        userId: admin.id,
        opcoId: ghana.id,
        role: 'admin',
        isActive: true,
      },
    });
    console.log('Seeded devops -> ghana (admin) OpCo assignment');

    const requester = await prisma.user.upsert({
      where: { email: 'requester@csquared.com' },
      update: { name: 'Demo Requester' },
      create: {
        keycloakId: 'seed-demo-requester',
        email: 'requester@csquared.com',
        name: 'Demo Requester',
      },
    });

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
    });
    console.log('Seeded 1 sample change request');
  }

  // Group CTO (Samuel): group admin, seated on the group CAB and every OpCo CAB (secondee).
  const samuel = await prisma.user.upsert({
    where: { email: 'syeboah@csquared.com' },
    update: { name: 'Samuel Yeboah' },
    create: {
      keycloakId: '3feaae6a-8611-45e2-aa73-4a32eacc722f',
      email: 'syeboah@csquared.com',
      name: 'Samuel Yeboah',
    },
  });
  // group CAB (opcoId null) — find-then-create (NULL opcoId isn't uniquely upsertable)
  const samuelGroup = await prisma.cABMembership.findFirst({
    where: { userId: samuel.id, opcoId: null },
  });
  if (!samuelGroup) {
    await prisma.cABMembership.create({
      data: { userId: samuel.id, opcoId: null },
    });
  }
  console.log('Seeded Group CTO Samuel + group CAB membership');

  const residentCtoNames: Record<string, string> = {
    ghana: 'Ama Owusu',
    uganda: 'David Okello',
    drc: 'Céline Mbiya',
    togo: 'Kossi Adjavon',
    liberia: 'Joseph Kollie',
    mauritius: 'Priya Ramphul',
  };
  for (const o of opcos) {
    const opco = await prisma.opCo.findUnique({ where: { slug: o.slug } });
    if (!opco) continue;
    // Resident CTO: OpCo admin + OpCo CAB member.
    const cto = await prisma.user.upsert({
      where: { email: `${o.slug}.cto@csquared.com` },
      update: { name: residentCtoNames[o.slug] },
      create: {
        keycloakId: `seed-${o.slug}-cto`,
        email: `${o.slug}.cto@csquared.com`,
        name: residentCtoNames[o.slug],
      },
    });
    await prisma.userOpCoAssignment.upsert({
      where: { userId_opcoId: { userId: cto.id, opcoId: opco.id } },
      update: { role: 'admin', isActive: true },
      create: {
        userId: cto.id,
        opcoId: opco.id,
        role: 'admin',
        isActive: true,
      },
    });
    await prisma.cABMembership.upsert({
      where: { userId_opcoId: { userId: cto.id, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId: cto.id, opcoId: opco.id },
    });
    // Samuel as secondee on every OpCo CAB.
    await prisma.cABMembership.upsert({
      where: { userId_opcoId: { userId: samuel.id, opcoId: opco.id } },
      update: { isActive: true, endedAt: null },
      create: { userId: samuel.id, opcoId: opco.id },
    });
  }
  console.log(
    'Seeded resident CTOs (admin + OpCo CAB) and Samuel as secondee on all OpCo CABs',
  );

  // Sample delegation: Ghana CTO delegates to a deputy for the next 30 days.
  const ghanaOpco = await prisma.opCo.findUnique({ where: { slug: 'ghana' } });
  const ghanaCto = await prisma.user.findUnique({
    where: { email: 'ghana.cto@csquared.com' },
  });
  if (ghanaOpco && ghanaCto) {
    const deputy = await prisma.user.upsert({
      where: { email: 'ghana.deputy@csquared.com' },
      update: { name: 'Kofi Deputy' },
      create: {
        keycloakId: 'seed-ghana-deputy',
        email: 'ghana.deputy@csquared.com',
        name: 'Kofi Deputy',
      },
    });
    const existing = await prisma.approverDelegation.findFirst({
      where: {
        fromUserId: ghanaCto.id,
        toUserId: deputy.id,
        opcoId: ghanaOpco.id,
        isActive: true,
      },
    });
    if (!existing) {
      await prisma.approverDelegation.create({
        data: {
          opcoId: ghanaOpco.id,
          fromUserId: ghanaCto.id,
          toUserId: deputy.id,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
    console.log('Seeded sample delegation: Ghana CTO → deputy');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
