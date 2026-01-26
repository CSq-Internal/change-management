import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

function createPrismaClient() {
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL
  if (accelerateUrl) {
    return new PrismaClient({ accelerateUrl, log: ['warn', 'error'] })
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL or PRISMA_ACCELERATE_URL must be set to use PrismaClient.')
  }

  const pool = globalForPrisma.pool ?? new Pool({ connectionString })
  if (process.env.NODE_ENV !== 'production') globalForPrisma.pool = pool

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter, log: ['warn', 'error'] })
}

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}
