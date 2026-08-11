import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '../common/auth-user';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Expiration du refresh — sert à poser le cookie côté dashboard. */
  refreshExpiresAt: Date;
}

interface AccessPayload {
  sub: string;
  role: Role;
  agencyId: string | null;
}

/**
 * Émission et rotation des jetons.
 *
 * Le refresh token est un secret aléatoire, stocké **haché** (SHA-256) : une
 * fuite de la table ne donne aucune session. Rotation stricte à chaque usage.
 *
 * ⚠️ Un jeton déjà consommé qui revient est traité comme un vol : toutes les
 * sessions de l'utilisateur sont coupées. Corollaire non négociable côté
 * client : sérialiser les appels à /auth/refresh (une seule promesse partagée),
 * sinon un double montage d'effet React détruit la session à chaque ouverture.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTtlMs(): number {
    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2];
    const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000;
    return value * factor;
  }

  async issue(
    user: AuthUser,
    context: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<TokenPair> {
    const payload: AccessPayload = { sub: user.id, role: user.role, agencyId: user.agencyId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs());

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
      },
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Consomme un refresh token et en émet un nouveau (rotation). */
  async rotate(
    refreshToken: string,
    context: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{ pair: TokenPair; user: AuthUser }> {
    const tokenHash = this.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Session inconnue. Reconnectez-vous.');

    if (stored.revokedAt) {
      // Jeton déjà consommé : on suppose un vol et on coupe tout.
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Session compromise. Reconnectez-vous.');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée. Reconnectez-vous.');
    }

    if (stored.user.blocked) throw new UnauthorizedException('Compte bloqué.');

    const user: AuthUser = {
      id: stored.user.id,
      role: stored.user.role,
      agencyId: stored.user.agencyId,
    };
    const pair = await this.issue(user, context);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: this.hash(pair.refreshToken) },
    });

    return { pair, user };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
