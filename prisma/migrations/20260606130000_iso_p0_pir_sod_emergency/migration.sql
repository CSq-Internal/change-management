-- PIR outcome enum
CREATE TYPE "PirOutcome" AS ENUM ('success', 'partial', 'failed');

-- ChangeRequest: implementer + emergency-expedited + retrospective tracking
ALTER TABLE "ChangeRequest"
  ADD COLUMN "implementedById" TEXT,
  ADD COLUMN "implementedAt" TIMESTAMP(3),
  ADD COLUMN "expedited" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retroApprovalDueAt" TIMESTAMP(3),
  ADD COLUMN "retroApprovedAt" TIMESTAMP(3);

ALTER TABLE "ChangeRequest"
  ADD CONSTRAINT "ChangeRequest_implementedById_fkey"
  FOREIGN KEY ("implementedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Post-implementation review (1:1 with change)
CREATE TABLE "PostImplementationReview" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "outcome" "PirOutcome" NOT NULL,
  "summary" TEXT NOT NULL,
  "backoutUsed" BOOLEAN NOT NULL DEFAULT false,
  "authorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostImplementationReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostImplementationReview_changeId_key" ON "PostImplementationReview"("changeId");
CREATE INDEX "PostImplementationReview_changeId_idx" ON "PostImplementationReview"("changeId");
ALTER TABLE "PostImplementationReview"
  ADD CONSTRAINT "PostImplementationReview_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PostImplementationReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
