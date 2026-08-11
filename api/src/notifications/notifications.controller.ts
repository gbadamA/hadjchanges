import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Notification } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications, la plus récente en tête.' })
  list(@CurrentUser() current: AuthUser): Promise<Notification[]> {
    return this.notifications.listFor(current.id);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marquer toutes mes notifications comme lues.' })
  async read(@CurrentUser() current: AuthUser): Promise<{ marked: number }> {
    return { marked: await this.notifications.markRead(current.id) };
  }
}
