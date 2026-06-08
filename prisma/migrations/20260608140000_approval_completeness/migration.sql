CREATE TYPE "AssigneeRole" AS ENUM ('approver', 'implementer');

ALTER TABLE "ChangeAssignee" ADD COLUMN "role" "AssigneeRole" NOT NULL DEFAULT 'implementer';

CREATE TABLE "ApproverAssignment" (
    "id" TEXT NOT NULL,
    "infrastructureType" TEXT NOT NULL,
    "opcoId" TEXT,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApproverAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApproverAssignment_infrastructureType_opcoId_userId_key" ON "ApproverAssignment"("infrastructureType", "opcoId", "userId");
CREATE INDEX "ApproverAssignment_infrastructureType_opcoId_idx" ON "ApproverAssignment"("infrastructureType", "opcoId");
CREATE INDEX "ApproverAssignment_userId_idx" ON "ApproverAssignment"("userId");

ALTER TABLE "ApproverAssignment" ADD CONSTRAINT "ApproverAssignment_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApproverAssignment" ADD CONSTRAINT "ApproverAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
