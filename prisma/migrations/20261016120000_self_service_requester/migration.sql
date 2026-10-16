-- Requester access is self-service from 2026-10-16. Grant only the pending
-- requester requests joinOpCo itself would allow: an active user who has never
-- had an OpCo assignment, for an OpCo that isn't archived, and only their
-- earliest such request. Each grant is audited as access.join, as joinOpCo does.
-- Everything else stays in the queue for an admin, including users an admin
-- removed or deactivated and requests for a second OpCo. One statement, so the
-- rows chosen, inserted, audited and marked approved are the same snapshot.
WITH "grantable" AS (
  SELECT DISTINCT ON (ar."userId") ar."id", ar."userId", ar."opcoId", o."name" AS "opcoName"
  FROM "AccessRequest" ar
  JOIN "User" u ON u."id" = ar."userId"
  JOIN "OpCo" o ON o."id" = ar."opcoId"
  WHERE ar."status" = 'pending'::"AccessRequestStatus"
    AND ar."role" = 'requester'::"Role"
    AND u."isActive"
    AND o."archivedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "UserOpCoAssignment" a WHERE a."userId" = ar."userId")
  ORDER BY ar."userId", ar."createdAt"
),
"granted" AS (
  INSERT INTO "UserOpCoAssignment" ("id", "userId", "opcoId", "role", "isActive", "startedAt")
  SELECT 'ssr_' || g."id", g."userId", g."opcoId", 'requester'::"Role", true, now()
  FROM "grantable" g
  RETURNING "userId"
),
"audited" AS (
  INSERT INTO "AdminAuditLog" ("id", "actorId", "action", "opcoId", "targetUserId", "summary", "metadata", "at")
  SELECT 'ssra_' || g."id", g."userId", 'access.join', g."opcoId", g."userId",
         'Joined ' || g."opcoName" || ' as requester (auto-approved at deploy)',
         jsonb_build_object('accessRequestId', g."id", 'autoApproved', true),
         now()
  FROM "grantable" g
  RETURNING "id"
)
UPDATE "AccessRequest"
SET "status" = 'approved'::"AccessRequestStatus",
    "decidedAt" = now(),
    "decisionReason" = 'Auto-approved: requester access is self-service'
WHERE "id" IN (SELECT "id" FROM "grantable")
