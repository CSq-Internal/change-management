import { NextResponse } from 'next/server'
import { prisma } from '@/server/db'

export async function GET() {
  const items = await prisma.changeRequest.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { approvals: true, attachments: true }
  })
  return NextResponse.json(items)
}
