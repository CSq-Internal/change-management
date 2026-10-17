-- Group CAB seats and group approver overrides have "opcoId" = NULL, and a plain unique
-- index treats each NULL as different, so the same group row could be stored twice.
-- NULLS NOT DISTINCT (Postgres 15+) makes NULL one value for these keys.

-- Existing duplicates would block the new indexes. Keep one row per key: the active one
-- if any, else the newest. The rows removed are copies of the row that stays.
DELETE FROM "CABMembership" c
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "userId", "opcoId" ORDER BY "isActive" DESC, "addedAt" DESC, "id"
  ) AS n
  FROM "CABMembership" WHERE "opcoId" IS NULL
) d
WHERE c."id" = d."id" AND d.n > 1;

DELETE FROM "ApproverAssignment" a
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "infrastructureType", "opcoId", "userId" ORDER BY "isActive" DESC, "createdAt" DESC, "id"
  ) AS n
  FROM "ApproverAssignment" WHERE "opcoId" IS NULL
) d
WHERE a."id" = d."id" AND d.n > 1;

DROP INDEX "CABMembership_userId_opcoId_key";
CREATE UNIQUE INDEX "CABMembership_userId_opcoId_key" ON "CABMembership"("userId", "opcoId") NULLS NOT DISTINCT;

DROP INDEX "ApproverAssignment_infrastructureType_opcoId_userId_key";
CREATE UNIQUE INDEX "ApproverAssignment_infrastructureType_opcoId_userId_key"
  ON "ApproverAssignment"("infrastructureType", "opcoId", "userId") NULLS NOT DISTINCT;
