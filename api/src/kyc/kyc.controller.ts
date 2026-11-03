import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycStatus, Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import {
  kycQueueSchema,
  rejectKycSchema,
  submitKycSchema,
  type RejectKycInput,
  type SubmitKycInput,
} from './kyc.schemas';
import { KycService, type KycDocumentView } from './kyc.service';

/** Agents habilités à voir et trancher un dossier d'identité. */
const REVIEWERS = [Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Roles(Role.CLIENT)
  @Post('documents')
  @ApiOperation({ summary: 'Déclarer sa pièce d’identité (type, numéro, expiration), sans photo.' })
  @ApiZodBody('SubmitKyc', submitKycSchema)
  submit(
    @ZBody(submitKycSchema) body: SubmitKycInput,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<KycDocumentView> {
    return this.kyc.submit(body, current, request.ip);
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
