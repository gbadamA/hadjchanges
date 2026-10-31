-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('EN_COURS', 'REUSSI', 'ECHOUE', 'EXPIRE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('EN_COURS', 'REUSSI', 'ECHOUE', 'ANNULE');

-- CreateTable
CREATE TABLE "PaymentCheckout" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "amountXof" DECIMAL(18,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'EN_COURS',
    "providerTransactionId" TEXT,
    "failureCode" TEXT,
    "launchUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPayout" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPayoutId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "receiveAmountXof" DECIMAL(18,2) NOT NULL,
    "feeXof" DECIMAL(18,2),
    "mobile" TEXT NOT NULL,
    "beneficiary" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'EN_COURS',
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transactionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCheckout_providerSessionId_key" ON "PaymentCheckout"("providerSessionId");

-- CreateIndex
CREATE INDEX "PaymentCheckout_transactionId_idx" ON "PaymentCheckout"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentCheckout_status_createdAt_idx" ON "PaymentCheckout"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPayout_providerPayoutId_key" ON "PaymentPayout"("providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPayout_idempotencyKey_key" ON "PaymentPayout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentPayout_transactionId_idx" ON "PaymentPayout"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentPayout_status_lastCheckedAt_idx" ON "PaymentPayout"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "PaymentCheckout" ADD CONSTRAINT "PaymentCheckout_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPayout" ADD CONSTRAINT "PaymentPayout_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

