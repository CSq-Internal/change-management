-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('bug', 'confusing', 'missing', 'praise');

-- CreateEnum
CREATE TYPE "FeedbackSeverity" AS ENUM ('blocker', 'major', 'minor');

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "severity" "FeedbackSeverity",
    "body" TEXT NOT NULL,
    "route" VARCHAR(200) NOT NULL,
    "roles" VARCHAR(300) NOT NULL,
    "opcoSlugs" VARCHAR(200) NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "changeId" TEXT,
    "appVersion" VARCHAR(40) NOT NULL,
    "viewport" VARCHAR(20) NOT NULL,
    "userAgent" VARCHAR(300) NOT NULL,
    "triagedAt" TIMESTAMP(3),
    "outcome" VARCHAR(20),
    "triageNote" TEXT,
    "triagedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_category_createdAt_idx" ON "feedback"("category", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_triagedAt_createdAt_idx" ON "feedback"("triagedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added (Prisma cannot express CHECK constraints): a triage MUST record what was
-- decided. A bare "triaged" flag cannot tell "fixed in #155" from "won't fix", so the
-- database refuses a triagedAt without an outcome rather than trusting every caller to.
ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_triage_needs_outcome"
  CHECK ("triagedAt" IS NULL OR "outcome" IS NOT NULL);
