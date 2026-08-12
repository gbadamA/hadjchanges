import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReceiptStatus, Role, TransactionStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { ExportService } from '../documents/export.service';
import type { UploadedDocument } from '../kyc/kyc.service';
import { counterTransactionSchema, type CounterTransactionInput } from './counter.schemas';
import { CounterService } from './counter.service';
import { ReceiptsService, type ReceiptQueueRow } from './receipts.service';
import {
  cancelSchema,
  createTransactionSchema,
  exportQuerySchema,
  receiptRejectSchema,
  receiptReviewSchema,
  transactionListSchema,
  type CancelInput,
  type CreateTransactionInput,
  type ReceiptRejectInput,
} from './transactions.schemas';
import { TransactionsService } from './transactions.service';
import type { TransactionView } from './transactions.view';

/** Agents habilités à contrôler un reçu et à faire avancer une transaction. */
const STAFF = [Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly receipts: ReceiptsService,
    private readonly exports: ExportService,
    private readonly counter: CounterService,
  ) {}

  @Roles(Role.CLIENT)
  @Post()
  @ApiOperation({ summary: 'Créer une opération de change (KYC validé obligatoire).' })
  @ApiZodBody('CreateTransaction', createTransactionSchema)
  create(
    @ZBody(createTransactionSchema) body: CreateTransactionInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.transactions.create(body, current, request.ip);
  }

  /**
   * Opération au guichet : le client est devant l'agent, avec ses espèces.
   * Tout se fait d'un coup — saisie, change, caisse, clôture — et le reçu
   * s'imprime dans la foulée.
   */
  @Roles(...STAFF)
  @Post('counter')
  @ApiOperation({ summary: 'Enregistrer et exécuter une opération au guichet.' })
  @ApiZodBody('CounterTransaction', counterTransactionSchema)
  counterTransaction(
    @ZBody(counterTransactionSchema) body: CounterTransactionInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.counter.execute(body, current, request.ip);
  }

  @Roles(Role.CLIENT)
  @Get('mine')
  @ApiOperation({ summary: 'Mes opérations, la plus récente en tête.' })
  mine(
    @CurrentUser() current: AuthUser,
    @Query('status') status?: TransactionStatus,
  ): Promise<TransactionView[]> {
    return this.transactions.mine(current, status);
  }

  @Roles(...STAFF)
  @Get()
  @ApiOperation({ summary: 'Liste des transactions, filtrable (dashboard).' })
  list(@Query() query: unknown, @CurrentUser() current: AuthUser): Promise<TransactionView[]> {
    return this.transactions.list(transactionListSchema.parse(query), current);
  }

  /**
   * Export des transactions. Ouvert aussi au CLIENT : `forExport` restreint
   * alors la requête à ses propres opérations (cahier §3.2 « export de
   * l'historique »).
   */
  @Get('export')
  @ApiOperation({ summary: 'Exporter les transactions (csv ou xlsx).' })
  async export(
    @Query() query: unknown,
    @CurrentUser() current: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const { format, ...filters } = exportQuerySchema.parse(query);
    const rows = await this.transactions.forExport(transactionListSchema.parse(filters), current);
    const buffer = await this.exports.build(rows, format);

    response.setHeader('content-type', this.exports.mimeType(format));
    response.setHeader(
      'content-disposition',
      `attachment; filename="${this.exports.filename(format)}"`,
    );
    response.setHeader('cache-control', 'no-store, private');
    response.send(buffer);
  }

  @Roles(...STAFF)
  @Get('receipts/queue')
  @ApiOperation({ summary: 'File des reçus de paiement à contrôler.' })
  receiptQueue(
    @CurrentUser() current: AuthUser,
    @Query('status') status?: ReceiptStatus,
  ): Promise<ReceiptQueueRow[]> {
    return this.receipts.queue(current, status ?? ReceiptStatus.EN_ATTENTE);
  }

  @Get('receipts/:id/file')
  @ApiOperation({ summary: 'Lire un justificatif de paiement (propriétaire ou agent).' })
  async receiptFile(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, mimeType } = await this.receipts.readFile(id, current);
    response.setHeader('content-type', mimeType);
    response.setHeader('cache-control', 'no-store, private');
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    response.send(buffer);
  }

  @Roles(...STAFF)
  @Post('receipts/:id/approve')
  @ApiOperation({ summary: 'Valider un reçu — exécute le change dans la foulée.' })
  @ApiZodBody('ReviewReceipt', receiptReviewSchema)
  approveReceipt(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.receipts.approve(id, receiptReviewSchema.parse(body ?? {}), current, request.ip);
  }

  @Roles(...STAFF)
  @Post('receipts/:id/reject')
  @ApiOperation({ summary: 'Rejeter un reçu, avec motif transmis au client.' })
  @ApiZodBody('RejectReceipt', receiptRejectSchema)
  rejectReceipt(
    @Param('id') id: string,
    @ZBody(receiptRejectSchema) body: ReceiptRejectInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.receipts.reject(id, body, current, request.ip);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une transaction (la sienne, ou toutes pour un agent).' })
  findOne(@Param('id') id: string, @CurrentUser() current: AuthUser): Promise<TransactionView> {
    return this.transactions.findOne(id, current);
  }

  /** Justificatif final — disponible une fois l'opération clôturée. */
  @Get(':id/justificatif.pdf')
  @ApiOperation({ summary: 'Télécharger le justificatif PDF de l’opération.' })
  async justificatif(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.transactions.receiptPdf(id, current);
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `attachment; filename="${filename}"`);
    response.setHeader('cache-control', 'no-store, private');
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    response.send(buffer);
  }

  @Roles(Role.CLIENT)
  @Post(':id/receipt')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiOperation({ summary: 'Déposer la preuve de paiement.' })
  submitReceipt(
    @Param('id') id: string,
    @UploadedFile() file: UploadedDocument | undefined,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.receipts.submit(id, file, current, request.ip);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Annuler une opération non encore exécutée.' })
  @ApiZodBody('CancelTransaction', cancelSchema)
  cancel(
    @Param('id') id: string,
    @ZBody(cancelSchema) body: CancelInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.transactions.cancel(id, body, current, request.ip);
  }

  @Roles(...STAFF)
  @Post(':id/ready')
  @ApiOperation({ summary: 'Marquer les fonds disponibles pour retrait.' })
  ready(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.transactions.markReady(id, current, request.ip);
  }

  @Roles(...STAFF)
  @Post(':id/close')
  @ApiOperation({ summary: 'Clôturer : les fonds ont été remis au client.' })
  close(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<TransactionView> {
    return this.transactions.close(id, current, request.ip);
  }
}
