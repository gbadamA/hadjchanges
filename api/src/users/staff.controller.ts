import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycStatus, Role } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect, type PublicUser } from './users.repository';

const assignSchema = z.object({
  /** null détache l'opérateur de son agence (mutation, départ). */
  agencyId: z.string().cuid().nullable(),
});

const createStaffSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().email().optional(),
  role: z.enum([Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN]),
  agencyId: z.string().cuid().nullish(),
});

const roleSchema = z.object({
  role: z.enum([Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN]),
});

const accessSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Mot de passe provisoire lisible à voix haute : pas de `l`/`1`/`O`/`0`, qui se
 * confondent quand on le dicte au téléphone à un agent d'agence.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generatePassword(length = 14): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  // Une ponctuation garantie : les politiques de mot de passe l'exigent souvent,
  // et l'utilisateur changera de toute façon ce mot de passe provisoire.
  return `${out}#7`;
}

const listSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  agencyId: z.string().cuid().optional(),
});

/**
 * Comptes internes (cahier §3.1 « affectation des opérateurs aux agences »).
 *
 * Séparé de `UsersController`, qui sert le profil du porteur du jeton : ici on
 * agit **sur d'autres personnes**, ce qui n'est pas la même responsabilité ni
 * les mêmes droits.
 */
@ApiTags('équipe')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Comptes internes (opérateurs, admins).' })
  list(@Query() query: unknown): Promise<PublicUser[]> {
    const { role, agencyId } = listSchema.parse(query);
    return this.prisma.user.findMany({
      // Les clients ne sont pas de l'équipe : ils ont leur propre écran.
      where: { role: role ?? { not: Role.CLIENT }, agencyId },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      select: publicUserSelect,
    });
  }

  /**
   * Création d'un compte interne — **réservée au super-administrateur**
   * (CLAUDE.md §4 : seul lui gère l'équipe).
   *
   * Le mot de passe est **tiré au sort par le serveur et rendu une seule fois**,
   * plutôt que choisi par l'administrateur : c'est ce qui évite les « Passer123 »
   * distribués à toute l'agence. Il n'est stocké qu'en empreinte, et le compte
   * n'a pas de KYC — un agent n'est pas un client.
   */
  @Roles(Role.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Créer un compte interne (mot de passe provisoire rendu une fois).' })
  @ApiZodBody('CreateStaff', createStaffSchema)
  async create(
    @ZBody(createStaffSchema) body: z.infer<typeof createStaffSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<PublicUser & { temporaryPassword: string }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] },
    });
    if (existing) throw new ConflictException('Ce téléphone ou cet email est déjà utilisé.');

    if (body.role === Role.OPERATEUR && body.agencyId) {
      const agency = await this.prisma.agency.findUnique({ where: { id: body.agencyId } });
      if (!agency) throw new NotFoundException('Agence introuvable.');
    }

    const temporaryPassword = generatePassword();
    const user = await this.prisma.user.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        email: body.email ?? null,
        role: body.role,
        // Un opérateur tient une caisse : il est rattaché. Un admin voit tout
        // le réseau, lui coller une agence restreindrait ses écrans.
        agencyId: body.role === Role.OPERATEUR ? (body.agencyId ?? null) : null,
        kycStatus: KycStatus.VALIDE,
        passwordHash: await this.passwords.hash(temporaryPassword),
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: current.id,
      action: 'staff.create',
      entity: 'User',
      entityId: user.id,
      after: { role: body.role, phone: body.phone, agencyId: user.agencyId },
      ip: request.ip,
    });

    return { ...user, temporaryPassword };
  }

  /** Changer le rôle d'un agent — promotion, mutation, retrait de droits. */
  @Roles(Role.SUPER_ADMIN)
  @Patch(':id/role')
  @ApiOperation({ summary: 'Changer le rôle d’un compte interne.' })
  @ApiZodBody('ChangeRole', roleSchema)
  async changeRole(
    @Param('id') id: string,
    @ZBody(roleSchema) body: z.infer<typeof roleSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role === Role.CLIENT) throw new NotFoundException('Compte interne introuvable.');
    // Se retirer ses propres droits enfermerait dehors le seul compte capable
    // de les rendre.
    if (id === current.id) {
      throw new ConflictException('Vous ne pouvez pas changer votre propre rôle.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: body.role,
        agencyId: body.role === Role.OPERATEUR ? user.agencyId : null,
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: current.id,
      action: 'staff.change_role',
      entity: 'User',
      entityId: id,
      before: { role: user.role },
      after: { role: body.role },
      ip: request.ip,
    });
    return updated;
  }

  /** Suspension d'un agent : l'accès tombe immédiatement, le compte reste. */
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/access')
  @ApiOperation({ summary: 'Suspendre ou rétablir l’accès d’un agent.' })
  @ApiZodBody('StaffAccess', accessSchema)
  async setAccess(
    @Param('id') id: string,
    @ZBody(accessSchema) body: z.infer<typeof accessSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role === Role.CLIENT) throw new NotFoundException('Compte interne introuvable.');
    if (id === current.id) {
      throw new ConflictException('Vous ne pouvez pas suspendre votre propre accès.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        blocked: body.suspended,
        blockedReason: body.suspended ? (body.reason ?? 'Accès suspendu.') : null,
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: current.id,
      action: body.suspended ? 'staff.suspend' : 'staff.restore',
      entity: 'User',
      entityId: id,
      before: { blocked: user.blocked },
      after: { blocked: body.suspended, reason: body.reason ?? null },
      ip: request.ip,
    });
    return updated;
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/agency')
  @ApiOperation({ summary: 'Affecter un opérateur à une agence (ou l’en détacher).' })
  @ApiZodBody('AssignAgency', assignSchema)
  async assign(
    @Param('id') id: string,
    @ZBody(assignSchema) body: z.infer<typeof assignSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.role !== Role.OPERATEUR) {
      // Un admin travaille sur tout le réseau : lui coller une agence
      // restreindrait ses écrans sans que personne comprenne pourquoi.
      throw new NotFoundException('Seul un opérateur se rattache à une agence.');
    }
    if (body.agencyId) {
      const agency = await this.prisma.agency.findUnique({ where: { id: body.agencyId } });
      if (!agency) throw new NotFoundException('Agence introuvable.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { agencyId: body.agencyId },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: current.id,
      action: 'staff.assign_agency',
      entity: 'User',
      entityId: id,
      before: { agencyId: user.agencyId },
      after: { agencyId: body.agencyId },
      ip: request.ip,
    });
    return updated;
  }
}
