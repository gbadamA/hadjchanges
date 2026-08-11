import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgenciesModule } from './agencies/agencies.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CashModule } from './cash/cash.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { loadEnv } from './config/env';
import { CurrenciesModule } from './currencies/currencies.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health.controller';
import { KycModule } from './kyc/kyc.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotesModule } from './quotes/quotes.module';
import { RatesModule } from './rates/rates.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SettingsModule } from './settings/settings.module';
import { TransactionsModule } from './transactions/transactions.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    SettingsModule,
    StorageModule,
    NotificationsModule,
    CashModule,
    DocumentsModule,
    AuthModule,
    UsersModule,
    KycModule,
    CurrenciesModule,
    RealtimeModule,
    RatesModule,
    QuotesModule,
    TransactionsModule,
    AgenciesModule,
  ],
  controllers: [HealthController],
  providers: [
    // L'ordre compte : on authentifie, PUIS on vérifie le rôle, PUIS on limite
    // le débit. Le défaut est fermé — une route est protégée sauf @Public.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
