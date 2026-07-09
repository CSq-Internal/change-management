-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "externalUrl" TEXT,
ALTER COLUMN "storageKey" DROP NOT NULL;
