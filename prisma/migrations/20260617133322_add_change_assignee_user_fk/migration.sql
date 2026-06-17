-- AddForeignKey
ALTER TABLE "ChangeAssignee" ADD CONSTRAINT "ChangeAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
