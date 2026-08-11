import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { UsersRepository, type PublicUser } from '../users/users.repository';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { PasswordService } from './password.service';
import { TokenService, type TokenPair } from './token.service';

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

export interface RequestContext {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inscription client. Le compte naît en `NON_SOUMIS` : il peut consulter et
   * simuler, mais aucune transaction n'est possible tant que le KYC n'est pas
   * validé (cahier §3.2). Cette règle est portée par le service de
   * transaction, pas ici — ici on se contente de ne donner aucun privilège.
   */
  async register(input: RegisterInput, context: RequestContext): Promise<AuthResult> {
    if (await this.users.findByPhone(input.phone)) {
      throw new ConflictException('Un compte existe déjà avec ce numéro.');
    }
    if (input.email && (await this.users.findByEmail(input.email))) {
      throw new ConflictException('Un compte existe déjà avec cet email.');
    }

    const user = await this.users.create({
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email ?? null,
      passwordHash: await this.passwords.hash(input.password),
      role: Role.CLIENT,
    });

    await this.audit.record({
      userId: user.id,
      action: 'auth.register',
      entity: 'User',
      entityId: user.id,
      ip: context.ip,
    });

    return { user, tokens: await this.issueFor(user, context) };
  }

  async login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
    const account = await this.users.findByIdentifier(input.identifier);
    // Message volontairement identique dans les deux cas : ne pas révéler
    // quels numéros existent dans la base.
    const invalid = new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    if (!account) throw invalid;

    const ok = await this.passwords.compare(input.password, account.passwordHash);
    if (!ok) throw invalid;
    if (account.blocked) {
      throw new UnauthorizedException(account.blockedReason ?? 'Compte bloqué.');
    }

    await this.users.touchLogin(account.id);
    const user = await this.users.findById(account.id);
    if (!user) throw invalid;

    await this.audit.record({
      userId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: context.ip,
    });

    return { user, tokens: await this.issueFor(user, context) };
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
    const { pair, user } = await this.tokens.rotate(refreshToken, context);
    const profile = await this.users.findById(user.id);
    if (!profile) throw new UnauthorizedException('Compte introuvable.');
    return { user: profile, tokens: pair };
  }

  async logout(refreshToken: string | undefined, current: AuthUser | null): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
    if (current) {
      await this.audit.record({
        userId: current.id,
        action: 'auth.logout',
        entity: 'User',
        entityId: current.id,
      });
    }
  }

  private issueFor(user: PublicUser, context: RequestContext): Promise<TokenPair> {
    return this.tokens.issue(
      { id: user.id, role: user.role, agencyId: user.agencyId },
      context,
    );
  }
}
