import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/auth-user';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

interface AccessPayload {
  sub: string;
  role: Role;
  agencyId: string | null;
}

/**
 * Validation de l'access token.
 *
 * On relit l'utilisateur en base à chaque requête plutôt que de faire confiance
 * au seul contenu du jeton : un compte bloqué ou rétrogradé doit perdre ses
 * droits immédiatement, pas au bout de 15 minutes.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, agencyId: true, blocked: true },
    });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    if (user.blocked) throw new UnauthorizedException('Compte bloqué.');
    return { id: user.id, role: user.role, agencyId: user.agencyId };
  }
}
