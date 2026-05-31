// src/test/db.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

// Disable Ryuk resource reaper — not available on this network.
// Cleanup is handled explicitly in stopTestDb().
process.env.TESTCONTAINERS_RYUK_DISABLED = 'true'

let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>
let prisma: PrismaClient
let pool: Pool

export async function startTestDb() {
  container = await new PostgreSqlContainer('postgres:16').start()
  const connectionString = container.getConnectionUri()
  process.env.DATABASE_URL = connectionString

  execSync('pnpm prisma migrate deploy', { env: { ...process.env, DATABASE_URL: connectionString } })

  pool = new Pool({ connectionString })
  // Prevent unhandled 'error' events from the pool after container teardown.
  pool.on('error', () => {})
  const adapter = new PrismaPg(pool)
  prisma = new PrismaClient({ adapter })
  return prisma
}

export async function stopTestDb() {
  await prisma?.$disconnect()
  await pool?.end()
  await container?.stop()
}

export function getTestDb() {
  if (!prisma) throw new Error('Call startTestDb() first')
  return prisma
}
