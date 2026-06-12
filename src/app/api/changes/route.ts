import { NextResponse } from 'next/server'
import { getPrisma } from '@/server/db'

export async function GET() {
  try {
    const prisma = getPrisma()
    const items = await prisma.changeRequest.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { approvals: true, attachments: true }
    })
    return NextResponse.json(items)
  } catch {
    return NextResponse.json(
      { error: 'Database is not configured. Set DATABASE_URL or PRISMA_ACCELERATE_URL.' },
      { status: 500 }
    )
  }
}
