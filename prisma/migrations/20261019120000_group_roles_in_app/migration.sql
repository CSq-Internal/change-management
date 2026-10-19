-- Group roles (group_admin, group_auditor) now live on "User" and are granted in the CMS.
-- Stop the deploy when users exist but none is an active group admin: nobody could grant
-- the role. A fresh database (no users yet) passes. Every statement is re-runnable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User")
     AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isGroupAdmin" AND "isActive") THEN
    RAISE EXCEPTION 'No active group admin: set "isGroupAdmin" on at least one active user before deploying (see docs/superpowers/specs/2026-10-18-group-roles-in-app-design.md, section 3)';
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isGroupAuditor" BOOLEAN NOT NULL DEFAULT false;

-- The Keycloak Organizations mirror is gone. The column stays (nullable) so a code revert
-- still reads it; a later migration drops it.
ALTER TABLE "OpCo" ALTER COLUMN "keycloakOrgId" DROP NOT NULL;
