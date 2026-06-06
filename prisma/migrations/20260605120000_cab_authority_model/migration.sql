-- Drop the demo-era Group CTO flag (authority now comes from CAB membership)
ALTER TABLE "User" DROP COLUMN "isGroupCto";

-- Allow group-level delegations (opcoId NULL = group CAB)
ALTER TABLE "ApproverDelegation" ALTER COLUMN "opcoId" DROP NOT NULL;
