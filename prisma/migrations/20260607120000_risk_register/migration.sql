-- Risk Register
CREATE TYPE "RiskCategory" AS ENUM ('operational', 'security', 'compliance', 'technical');
CREATE TYPE "RiskStatus" AS ENUM ('open', 'mitigating', 'closed');

CREATE TABLE "RiskRegister" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "RiskCategory" NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "mitigationPlan" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'open',
    "reviewDate" TIMESTAMP(3),
    "opcoId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiskRegister_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskRegister_opcoId_idx" ON "RiskRegister"("opcoId");
CREATE INDEX "RiskRegister_status_idx" ON "RiskRegister"("status");

ALTER TABLE "RiskRegister" ADD CONSTRAINT "RiskRegister_opcoId_fkey" FOREIGN KEY ("opcoId") REFERENCES "OpCo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RiskRegister" ADD CONSTRAINT "RiskRegister_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
