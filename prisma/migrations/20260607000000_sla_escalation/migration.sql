-- Add SLA escalation tracking to ChangeRequest
ALTER TABLE "ChangeRequest" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChangeRequest" ADD COLUMN "lastEscalatedAt" TIMESTAMP(3);
