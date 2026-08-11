import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycStatus, Role } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import {
  kycQueueSchema,
  rejectKycSchema,
  submitKycSchema,
  type RejectKycInput,
} from './kyc.schemas';
import { KycService, type KycDocumentView, type UploadedDocument } from './kyc.service';

/** Agents habilités à voir et trancher un dossier d'identité. */
const REVIEWERS = [Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Roles(Role.CLIENT)
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'document', maxCount: 1 },
      { name: 'selfie', maxCount: 1 },
    ]),
  )
  @ApiOperation({ summary: 'Déposer sa pièce d’identité (et un selfie facultatif).' })
  @ApiZodBody('SubmitKyc', submitKycSchema)
  submit(
    @UploadedFiles() files: { document?: UploadedDocument[]; selfie?: UploadedDocument[] },
    // Le corps arrive en multipart : les champs sont des chaînes, d'où la
    // coercition dans le schéma Zod plutôt qu'un parse manuel ici.
    @Body() body: unknown,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<KycDocumentView> {
    const input = submitKycSchema.parse(body);
    return this.kyc.submit(
      input,
      { document: files.document?.[0], selfie: files.selfie?.[0] },
      current,
      request.ip,
    );
  }

  @Roles(Role.CLIENT)
  @Get('me')
  @ApiOperation({ summary: 'Mon statut de vérification et mon dernier dépôt.' })
  mine(@CurrentUser() current: AuthUser): Promise<{
    status: KycStatus;
    document: KycDocumentView | null;
  }> {
    return this.kyc.mine(current);
  }

  @Roles(...REVIEWERS)
  @Get('queue')
  @ApiOperation({ summary: 'File d’attente des dossiers d’identité à vérifier.' })
  queue(@Query() query: unknown): Promise<KycDocumentView[]> {
    const { status, take } = kycQueueSchema.parse(query);
    return this.kyc.queue(status, take);
  }

  /**
   * Sert le fichier après contrôle des droits. Pas de cache, pas d'indexation :
   * une pièce d'identité ne doit rester ni dans un proxy ni dans un moteur.
   */
  @Get('documents/:id/file')
  @ApiOperation({ summary: 'Lire la pièce déposée (propriétaire ou agent habilité).' })
  async file(
    @Param('id') id: string,
    @Query('kind') kind: string | undefined,
    @CurrentUser() current: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, mimeType } = await this.kyc.readFile(
      id,
      kind === 'selfie' ? 'selfie' : 'document',
      current,
    );
    response.setHeader('content-type', mimeType);
    response.setHeader('cache-control', 'no-store, private');
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    response.send(buffer);
  }

  @Roles(...REVIEWERS)
  @Post('documents/:id/approve')
  @ApiOperation({ summary: 'Valider une pièce d’identité.' })
  approve(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<KycDocumentView> {
    return this.kyc.approve(id, current, request.ip);
  }

  @Roles(...REVIEWERS)
  @Post('documents/:id/reject')
  @ApiOperation({ summary: 'Rejeter une pièce d’identité, avec motif transmis au client.' })
  @ApiZodBody('RejectKyc', rejectKycSchema)
  reject(
    @Param('id') id: string,
    @ZBody(rejectKycSchema) body: RejectKycInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<KycDocumentView> {
    return this.kyc.reject(id, body, current, request.ip);
  }
}
