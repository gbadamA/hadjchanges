import { Global, Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ReceiptPdfService } from './receipt-pdf.service';

/**
 * Documents produits par la plateforme : justificatifs PDF et exports.
 * Global parce que les transactions, et demain le reporting et la comptabilité,
 * en dépendent tous.
 */
@Global()
@Module({
  providers: [ReceiptPdfService, ExportService],
  exports: [ReceiptPdfService, ExportService],
})
export class DocumentsModule {}
