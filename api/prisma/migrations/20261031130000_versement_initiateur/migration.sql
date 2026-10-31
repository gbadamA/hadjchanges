-- AlterTable
ALTER TABLE "PaymentPayout" ADD COLUMN     "initiatedById" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "PaymentPayout" ADD CONSTRAINT "PaymentPayout_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

