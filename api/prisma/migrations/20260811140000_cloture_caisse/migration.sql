-- CreateTable
CREATE TABLE "CashClosure" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "businessDay" DATE NOT NULL,
    "closedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosureLine" (
    "id" TEXT NOT NULL,
    "closureId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "expected" DECIMAL(18,2) NOT NULL,
    "counted" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CashClosureLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashClosure_agencyId_businessDay_idx" ON "CashClosure"("agencyId", "businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "CashClosure_agencyId_businessDay_key" ON "CashClosure"("agencyId", "businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "CashClosureLine_closureId_currencyId_key" ON "CashClosureLine"("closureId", "currencyId");

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosureLine" ADD CONSTRAINT "CashClosureLine_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "CashClosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosureLine" ADD CONSTRAINT "CashClosureLine_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

