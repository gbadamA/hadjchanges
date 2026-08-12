import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { TransactionWithRelations } from '../transactions/transactions.view';
import { LABELS } from '../transactions/transaction-state-machine';

/** DA « bleu diplomatique & or » — mêmes valeurs que les tokens des deux fronts. */
const NAVY = '#0B2A4A';
const PRIMARY = '#0F3D6B';
const GOLD = '#C9A227';
const INK = '#0B1A2A';
const MUTED = '#5A6B7D';
const LINE = '#D8E3EF';

/** Espace fine insecable (U+202F) : absente de WinAnsi. */
const NARROW_NO_BREAK_SPACE = 0x202f;
/** Espace insecable ordinaire (U+00A0) : presente dans WinAnsi. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * ⚠️ `toLocaleString('fr-FR')` sépare les milliers par une **espace fine
 * insécable** (U+202F) que l'encodage WinAnsi des polices PDF standard ne
 * connaît pas : le montant s'imprimait « 200 /000 XOF ». On la remplace par
 * l'espace insécable ordinaire (U+00A0), elle présente dans WinAnsi, qui garde
 * le montant d'un seul tenant en fin de ligne.
 */
function formatAmount(value: string, decimals: number): string {
  const formatted = Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // Comparaison par CODE de caractere : ecrire ces deux espaces en clair dans
  // le source les rendrait invisibles, et le prochain lecteur les prendrait
  // pour une coquille a nettoyer.
  return formatted
    .split('')
    .map((char) => (char.charCodeAt(0) === NARROW_NO_BREAK_SPACE ? NO_BREAK_SPACE : char))
    .join('');
}

/** Libellés français des modes de paiement et de remise — jamais l'enum brute. */
const DEPOSIT_LABEL: Record<string, string> = {
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
  WAVE: 'Wave',
  CARTE_BANCAIRE: 'Carte bancaire',
  ESPECES_AGENCE: 'Espèces en agence',
};

const PAYOUT_LABEL: Record<string, string> = {
  ESPECES_AGENCE: 'Espèces en agence',
  MOBILE_MONEY: 'Mobile money',
  VIREMENT_BANCAIRE: 'Virement bancaire',
};

const MARGIN = 48;

/**
 * Justificatif final d'une opération de change (cahier §3.2).
 *
 * **PDFKit et non un rendu HTML** : un justificatif est un document à géométrie
 * fixe, et embarquer un Chromium pour en produire une page serait absurde à
 * héberger (même choix que les badges de FI-HADJ).
 *
 * Le document est généré **à la clôture** puis conservé : il doit rester
 * identique s'il est retéléchargé six mois plus tard, même si les taux, la
 * commission ou la raison sociale ont changé depuis.
 */
@Injectable()
export class ReceiptPdfService {
  build(transaction: TransactionWithRelations): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: {
      Title: `Justificatif ${transaction.reference}`,
      Author: 'HadjChanges',
    } });

    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    this.header(doc, transaction);
    this.amounts(doc, transaction);
    this.details(doc, transaction);
    this.timeline(doc, transaction);
    this.footer(doc, transaction);

    doc.end();
    return done;
  }

  private header(doc: PDFKit.PDFDocument, transaction: TransactionWithRelations): void {
    const width = doc.page.width;
    doc.rect(0, 0, width, 120).fill(NAVY);
    // Le filet doré est le seul aplat d'or du document : un accent, jamais une surface.
    doc.rect(0, 120, width, 3).fill(GOLD);

    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('HadjChanges', MARGIN, 34)
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#A9C2DC')
      .text('Bureau de change agréé · Abidjan, Côte d’Ivoire', MARGIN, 62);

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#FFFFFF')
      .text('JUSTIFICATIF D’OPÉRATION', MARGIN, 88)
      .font('Helvetica')
      .fontSize(10)
      .fillColor(GOLD)
      .text(transaction.reference, width - MARGIN - 200, 88, { width: 200, align: 'right' });

    doc.y = 150;
  }

  private amounts(doc: PDFKit.PDFDocument, transaction: TransactionWithRelations): void {
    const width = doc.page.width - MARGIN * 2;
    const top = doc.y;

    doc.roundedRect(MARGIN, top, width, 96, 8).fillAndStroke('#F5F8FC', LINE);

    const half = width / 2;
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('MONTANT REMIS PAR LE CLIENT', MARGIN + 20, top + 18, { width: half - 30 })
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(
        this.money(transaction.sourceAmount.toString(), transaction.sourceCurrency.decimals, transaction.sourceCurrency.code),
        MARGIN + 20,
        top + 36,
        { width: half - 30 },
      );

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('MONTANT REÇU PAR LE CLIENT', MARGIN + half + 10, top + 18, { width: half - 30 })
      .fillColor(PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(
        this.money(transaction.targetAmount.toString(), transaction.targetCurrency.decimals, transaction.targetCurrency.code),
        MARGIN + half + 10,
        top + 36,
        { width: half - 30 },
      );

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(
        `Taux appliqué : 1 ${transaction.direction === 'VENTE_DEVISE' ? transaction.targetCurrency.code : transaction.sourceCurrency.code} = ${transaction.appliedRate.toString()} XOF` +
          `   ·   Commission (${transaction.commissionPct.toString()} %) : ${this.money(transaction.commissionAmount.toString(), 0, 'XOF')}`,
        MARGIN + 20,
        top + 70,
        { width: width - 40 },
      );

    doc.y = top + 120;
  }

  private details(doc: PDFKit.PDFDocument, transaction: TransactionWithRelations): void {
    const rows: Array<[string, string]> = [
      ['Client', `${transaction.client.firstName} ${transaction.client.lastName}`],
      ['Téléphone', transaction.client.phone],
      ['Sens de l’opération', transaction.direction === 'VENTE_DEVISE' ? 'Achat de devises par le client' : 'Vente de devises par le client'],
      ['Mode de paiement', DEPOSIT_LABEL[transaction.depositMethod] ?? transaction.depositMethod],
      [
        'Mode de remise',
        transaction.payoutMethod
          ? (PAYOUT_LABEL[transaction.payoutMethod] ?? transaction.payoutMethod)
          : '—',
      ],
      ['Agence', transaction.agency ? `${transaction.agency.name} — ${transaction.agency.city}` : '—'],
      ['Origine', transaction.channel === 'GUICHET' ? 'Opération au guichet' : 'Application mobile'],
      // Le bénéficiaire ne figure QUE s'il diffère du client : une ligne
      // « bénéficiaire : lui-même » n'apprend rien et allonge le document.
      ...(transaction.beneficiaryName
        ? ([
            [
              'Bénéficiaire',
              transaction.beneficiaryRelation
                ? `${transaction.beneficiaryName} (${transaction.beneficiaryRelation})`
                : transaction.beneficiaryName,
            ],
          ] as Array<[string, string]>)
        : []),
      ['Contre-valeur', this.money(transaction.amountXof.toString(), 0, 'XOF')],
      ['Statut', LABELS[transaction.status]],
    ];

    this.section(doc, 'DÉTAIL DE L’OPÉRATION');
    for (const [label, value] of rows) {
      const y = doc.y;
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(10)
        .text(label, MARGIN, y, { width: 180 })
        .fillColor(INK)
        .font('Helvetica-Bold')
        .text(value, MARGIN + 190, y, { width: doc.page.width - MARGIN * 2 - 190 });
      doc.y = y + 18;
    }
    doc.y += 10;
  }

  private timeline(doc: PDFKit.PDFDocument, transaction: TransactionWithRelations): void {
    const steps: Array<[string, Date | null]> = [
      ['Opération créée', transaction.createdAt],
      ['Reçu de paiement déposé', transaction.receiptSubmittedAt],
      ['Reçu contrôlé', transaction.receiptReviewedAt],
      ['Change exécuté', transaction.executedAt],
      ['Fonds mis à disposition', transaction.readyAt],
      ['Opération clôturée', transaction.closedAt],
    ];

    this.section(doc, 'HORODATAGE');
    for (const [label, date] of steps) {
      if (!date) continue;
      const y = doc.y;
      doc.circle(MARGIN + 4, y + 5, 3).fill(GOLD);
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(10)
        .text(label, MARGIN + 16, y, { width: 240 })
        .fillColor(MUTED)
        .text(this.dateTime(date), MARGIN + 260, y, { width: 200 });
      doc.y = y + 16;
    }
    doc.y += 12;
  }

  private footer(doc: PDFKit.PDFDocument, transaction: TransactionWithRelations): void {
    const width = doc.page.width - MARGIN * 2;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).stroke(LINE);
    doc.y += 12;

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Ce document est un justificatif d’opération de change émis par HadjChanges. Il reprend les ' +
          'montants et le taux effectivement appliqués au moment de l’exécution. Conservez-le : il ' +
          'peut vous être demandé en cas de contrôle.',
        MARGIN,
        doc.y,
        { width, align: 'justify' },
      );

    doc.y += 8;
    doc.text(`Édité le ${this.dateTime(new Date())} · Référence ${transaction.reference}`, MARGIN, doc.y, {
      width,
    });
  }

  private section(doc: PDFKit.PDFDocument, title: string): void {
    doc
      .fillColor(PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title, MARGIN, doc.y);
    doc.y += 6;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + 60, doc.y).lineWidth(2).stroke(GOLD);
    doc.lineWidth(1);
    doc.y += 12;
  }

  private money(value: string, decimals: number, code: string): string {
    return `${formatAmount(value, decimals)} ${code}`;
  }

  private dateTime(date: Date): string {
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
