import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { LABELS } from '../transactions/transaction-state-machine';
import type { TransactionWithRelations } from '../transactions/transactions.view';

export type ExportFormat = 'csv' | 'xlsx';

interface Column {
  header: string;
  width: number;
  value: (row: TransactionWithRelations) => string | number | Date | null;
}

/**
 * Export des transactions (cahier §3.1 « Export Excel/PDF »).
 *
 * Deux formats, **une seule définition de colonnes** : le CSV et le classeur
 * Excel décrivent forcément les mêmes données, sinon deux exports du même
 * écran ne se recoupent pas en comptabilité.
 */
@Injectable()
export class ExportService {
  private readonly columns: Column[] = [
    { header: 'Référence', width: 18, value: (row) => row.reference },
    { header: 'Date', width: 18, value: (row) => row.createdAt },
    { header: 'Client', width: 26, value: (row) => `${row.client.firstName} ${row.client.lastName}` },
    { header: 'Téléphone', width: 14, value: (row) => row.client.phone },
    { header: 'Agence', width: 22, value: (row) => row.agency?.name ?? '' },
    {
      header: 'Sens',
      width: 22,
      value: (row) => (row.direction === 'VENTE_DEVISE' ? 'Vente de devise' : 'Achat de devise'),
    },
    { header: 'Devise remise', width: 13, value: (row) => row.sourceCurrency.code },
    // Les montants partent en NOMBRES (pas en chaînes) : un export qu'il faut
    // reconvertir cellule par cellule dans Excel ne sert à rien.
    { header: 'Montant remis', width: 16, value: (row) => Number(row.sourceAmount) },
    { header: 'Devise reçue', width: 13, value: (row) => row.targetCurrency.code },
    { header: 'Montant reçu', width: 16, value: (row) => Number(row.targetAmount) },
    { header: 'Taux appliqué', width: 14, value: (row) => Number(row.appliedRate) },
    { header: 'Commission (XOF)', width: 17, value: (row) => Number(row.commissionAmount) },
    { header: 'Contre-valeur (XOF)', width: 19, value: (row) => Number(row.amountXof) },
    { header: 'Statut', width: 22, value: (row) => LABELS[row.status] },
    { header: 'Clôturée le', width: 18, value: (row) => row.closedAt },
  ];

  async build(rows: TransactionWithRelations[], format: ExportFormat): Promise<Buffer> {
    return format === 'xlsx' ? this.xlsx(rows) : this.csv(rows);
  }

  filename(format: ExportFormat): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `hadjchanges-transactions-${stamp}.${format}`;
  }

  mimeType(format: ExportFormat): string {
    return format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8';
  }

  /**
   * CSV pour Excel francophone : **point-virgule** comme séparateur et **BOM
   * UTF-8** en tête. Sans le BOM, Excel lit le fichier en ANSI et affiche
   * « OpÃ©ration » ; sans le point-virgule, il empile tout dans une colonne.
   */
  private csv(rows: TransactionWithRelations[]): Buffer {
    const escape = (value: string | number | Date | null): string => {
      if (value === null) return '';
      if (value instanceof Date) return this.dateTime(value);
      if (typeof value === 'number') return String(value).replace('.', ','); // décimale française
      return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };

    const lines = [
      this.columns.map((column) => column.header).join(';'),
      ...rows.map((row) => this.columns.map((column) => escape(column.value(row))).join(';')),
    ];
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n'), 'utf8')]);
  }

  private async xlsx(rows: TransactionWithRelations[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HadjChanges';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Transactions', {
      views: [{ state: 'frozen', ySplit: 1 }], // l'en-tête reste visible au défilement
    });
    sheet.columns = this.columns.map((column) => ({ header: column.header, width: column.width }));

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D6B' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;

    for (const row of rows) {
      sheet.addRow(this.columns.map((column) => column.value(row)));
    }

    // Formats : montants avec séparateur de milliers, dates lisibles.
    for (const index of [8, 10, 12, 13]) {
      sheet.getColumn(index).numFmt = '# ##0.00';
    }
    sheet.getColumn(11).numFmt = '# ##0.000000';
    for (const index of [2, 15]) {
      sheet.getColumn(index).numFmt = 'dd/mm/yyyy hh:mm';
    }
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: this.columns.length } };

    return Buffer.from(await workbook.xlsx.writeBuffer());
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
