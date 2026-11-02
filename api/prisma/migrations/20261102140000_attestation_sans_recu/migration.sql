-- Suppression du parcours « recu photo » : plus de depot par le client, plus
-- de file de controle. La preuve de paiement est desormais l'attestation d'un
-- agent, ou l'evenement signe d'un operateur de paiement.
--
-- ⚠️ Destructive, mais ECRITE POUR CONVERTIR plutot que pour exiger une base
-- vide : la production l'est, pas les bases de developpement, et une migration
-- qui suppose l'un ou l'autre casse des qu'on se trompe.

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionStatus_new" AS ENUM ('CREEE', 'PAIEMENT_CONFIRME', 'CHANGE_EXECUTE', 'PRETE_POUR_RETRAIT', 'CLOTUREE', 'ANNULEE');
ALTER TABLE "public"."Transaction" ALTER COLUMN "status" DROP DEFAULT;

-- Conversion des anciens etats :
--  - RECU_VALIDE devient PAIEMENT_CONFIRME : le paiement etait acquis, il le reste ;
--  - RECU_SOUMIS et RECU_REJETE retournent en attente de paiement, puisque le
--    controle de justificatif qui les justifiait n'existe plus. Les laisser
--    tomber vers un etat « confirme » ferait executer un change sans qu'aucun
--    argent n'ait ete vu.
ALTER TABLE "Transaction" ALTER COLUMN "status" TYPE "TransactionStatus_new" USING (
  CASE "status"::text
    WHEN 'RECU_VALIDE' THEN 'PAIEMENT_CONFIRME'
    WHEN 'RECU_SOUMIS' THEN 'CREEE'
    WHEN 'RECU_REJETE' THEN 'CREEE'
    ELSE "status"::text
  END
)::"TransactionStatus_new";

ALTER TYPE "TransactionStatus" RENAME TO "TransactionStatus_old";
ALTER TYPE "TransactionStatus_new" RENAME TO "TransactionStatus";
DROP TYPE "public"."TransactionStatus_old";
ALTER TABLE "Transaction" ALTER COLUMN "status" SET DEFAULT 'CREEE';
COMMIT;

-- AlterTable : un seul horodatage de paiement, repris de l'ancien controle.
ALTER TABLE "Transaction" ADD COLUMN "paidAt" TIMESTAMP(3);
UPDATE "Transaction" SET "paidAt" = COALESCE("receiptReviewedAt", "receiptSubmittedAt");
ALTER TABLE "Transaction" DROP COLUMN "receiptReviewedAt",
DROP COLUMN "receiptSubmittedAt";

-- ⚠️ Un justificatif jamais valide n'a PAS d'auteur d'attestation, et le
-- nouveau modele en exige un. On le supprime plutot que d'inventer un agent
-- qui n'a rien constate : une attestation fausse vaut moins que pas
-- d'attestation du tout.
DELETE FROM "PaymentReceipt" WHERE "validatedById" IS NULL;

-- AlterTable
ALTER TABLE "PaymentReceipt" ADD COLUMN "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "attestedById" TEXT;
UPDATE "PaymentReceipt" SET "attestedById" = "validatedById",
  "attestedAt" = COALESCE("validatedAt", "createdAt");
ALTER TABLE "PaymentReceipt" ALTER COLUMN "attestedById" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "PaymentReceipt" DROP CONSTRAINT "PaymentReceipt_validatedById_fkey";

-- DropIndex
DROP INDEX "PaymentReceipt_status_createdAt_idx";

-- AlterTable
ALTER TABLE "PaymentReceipt" DROP COLUMN "fileUrl",
DROP COLUMN "mimeType",
DROP COLUMN "rejectReason",
DROP COLUMN "status",
DROP COLUMN "validatedAt",
DROP COLUMN "validatedById";

-- DropEnum
DROP TYPE "ReceiptStatus";

-- CreateIndex
CREATE INDEX "PaymentReceipt_attestedAt_idx" ON "PaymentReceipt"("attestedAt");

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_attestedById_fkey" FOREIGN KEY ("attestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
