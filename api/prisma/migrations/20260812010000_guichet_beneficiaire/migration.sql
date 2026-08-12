-- CreateEnum
CREATE TYPE "TransactionChannel" AS ENUM ('APPLICATION', 'GUICHET');

-- AlterTable
ALTER TABLE "KycDocument" ALTER COLUMN "fileUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "beneficiaryName" TEXT,
ADD COLUMN     "beneficiaryPhone" TEXT,
ADD COLUMN     "beneficiaryRelation" TEXT,
ADD COLUMN     "channel" "TransactionChannel" NOT NULL DEFAULT 'APPLICATION';

-- CreateIndex
CREATE INDEX "Transaction_channel_createdAt_idx" ON "Transaction"("channel", "createdAt");

