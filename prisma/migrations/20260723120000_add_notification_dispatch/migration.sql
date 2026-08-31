-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDispatch_userId_changeId_type_sentAt_idx" ON "NotificationDispatch"("userId", "changeId", "type", "sentAt");
