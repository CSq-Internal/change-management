-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('impact_scope', 'implementation_plan', 'testing_plan', 'backout_plan', 'solution_document');

-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN "driveFolderId" TEXT,
ADD COLUMN "reference" SERIAL;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "kind" "AttachmentKind" NOT NULL,
ADD COLUMN "uploadedById" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_reference_key" ON "ChangeRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_changeId_kind_key" ON "Attachment"("changeId", "kind");

-- CreateIndex
CREATE INDEX "Attachment_changeId_idx" ON "Attachment"("changeId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
