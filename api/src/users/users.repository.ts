import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Vue publique d'un utilisateur — ce qui sort de l'API, jamais le hash. */
export const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  role: true,
  kycStatus: true,
  kycRejectReason: true,
  blocked: true,
  agencyId: true,
  dailyLimitXof: true,
  monthlyLimitXof: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

/**
 * Accès aux utilisateurs. Le métier passe par ici, jamais par `prisma.user`
 * directement — c'est ce qui garantit qu'on n'exporte pas un `passwordHash`
 * par inadvertance (DIP + une seule définition de la vue publique).
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  /** Recherche par téléphone OU email — le client se connecte comme il veut. */
  findByIdentifier(identifier: string): Promise<User | null> {
    const normalized = identifier.trim().toLowerCase();
    const phone = identifier.replace(/[\s.+-]/g, '').replace(/^225/, '');
    return this.prisma.user.findFirst({
      where: { OR: [{ email: normalized }, { phone }] },
    });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput): Promise<PublicUser> {
    return this.prisma.user.create({ data, select: publicUserSelect });
  }

  touchLogin(id: string): Promise<unknown> {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }
}
