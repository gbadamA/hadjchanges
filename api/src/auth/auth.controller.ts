import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { AuthService, type AuthResult, type RequestContext } from './auth.service';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
} from './auth.schemas';

/** Nom du cookie de rafraîchissement (dashboard). */
const REFRESH_COOKIE = 'hc_refresh';

@ApiTags('authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Créer un compte client (statut KYC : non soumis).' })
  @ApiZodBody('Register', registerSchema)
  async register(
    @ZBody(registerSchema) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return this.respond(await this.auth.register(body, this.contextOf(req)), res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Se connecter par numéro de téléphone ou email.' })
  @ApiZodBody('Login', loginSchema)
  async login(
    @ZBody(loginSchema) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return this.respond(await this.auth.login(body, this.contextOf(req)), res);
  }

  /**
   * Rotation du jeton. Le dashboard envoie son cookie, le mobile envoie le
   * jeton dans le corps (AsyncStorage, pas de cookie).
   * ⚠️ Un seul appel à la fois côté client — voir TokenService.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Échanger un refresh token contre un nouveau couple de jetons.' })
  @ApiZodBody('Refresh', refreshSchema)
  async refresh(
    @ZBody(refreshSchema) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const token = body.refreshToken ?? this.cookieToken(req);
    if (!token) {
      return this.respondError(res, 'Aucun jeton de rafraîchissement fourni.');
    }
    return this.respond(await this.auth.refresh(token, this.contextOf(req)), res);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Fermer la session courante.' })
  async logout(
    @ZBody(refreshSchema) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() current: AuthUser | undefined,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? this.cookieToken(req), current ?? null);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  private contextOf(req: Request): RequestContext {
    return { userAgent: req.headers['user-agent'] ?? null, ip: req.ip ?? null };
  }

  private cookieToken(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.[REFRESH_COOKIE];
  }

  /**
   * Le refresh token part DEUX fois : en cookie httpOnly (consommé par le
   * dashboard, invisible du JavaScript) et dans le corps (consommé par le
   * mobile, qui n'a pas de cookies). Chaque client ignore ce qui ne le
   * concerne pas.
   */
  private respond(result: AuthResult, res: Response): unknown {
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: result.tokens.refreshExpiresAt,
      path: '/',
    });
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    };
  }

  private respondError(res: Response, message: string): unknown {
    res.status(401);
    return { statusCode: 401, message };
  }
}
