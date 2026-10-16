-- Requester access is self-service from 2026-10-16: grant every pending
-- requester request. Pending requests for higher roles stay in the queue.

-- An active row keeps its role, and an ended one comes back as requester.
INSERT INTO "UserOpCoAssignment" ("id", "userId", "opcoId", "role", "isActive", "startedAt")
SELECT 'ssr_' || ar."id", ar."userId", ar."opcoId", 'requester'::"Role", true, now()
FROM "AccessRequest" ar
WHERE ar."status" = 'pending'::"AccessRequestStatus" AND ar."role" = 'requester'::"Role"
ON CONFLICT ("userId", "opcoId") DO UPDATE SET
  "role" = CASE WHEN "UserOpCoAssignment"."isActive" THEN "UserOpCoAssignment"."role" ELSE 'requester'::"Role" END,
  "isActive" = true,
  "endedAt" = NULL;

UPDATE "AccessRequest"
SET "status" = 'approved'::"AccessRequestStatus",
    "decidedAt" = now(),
    "decisionReason" = 'Auto-approved: requester access is self-service'
WHERE "status" = 'pending'::"AccessRequestStatus" AND "role" = 'requester'::"Role";
