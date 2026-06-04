-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('lead', 'member');

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "role" "TeamRole" NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "OpCo" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CABMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opcoId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CABMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "opcoId" TEXT,
    "targetUserId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CABMembership_userId_opcoId_key" ON "CABMembership"("userId", "opcoId");

-- CreateIndex
CREATE INDEX "CABMembership_opcoId_idx" ON "CABMembership"("opcoId");

-- CreateIndex
CREATE INDEX "CABMembership_userId_idx" ON "CABMembership"("userId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_opcoId_idx" ON "AdminAuditLog"("opcoId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_idx" ON "AdminAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetUserId_idx" ON "AdminAuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_at_idx" ON "AdminAuditLog"("at");

-- AddForeignKey
ALTER TABLE "CABMembership" ADD CONSTRAINT "CABMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CABMembership" ADD CONSTRAINT "CABMembership_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
