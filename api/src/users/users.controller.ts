import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { UsersRepository, type PublicUser } from './users.repository';

@ApiTags('utilisateurs')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersRepository) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil de l’utilisateur connecté (statut KYC compris).' })
  async me(@CurrentUser() current: AuthUser): Promise<PublicUser> {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('Compte introuvable.');
    return user;
  }
}
