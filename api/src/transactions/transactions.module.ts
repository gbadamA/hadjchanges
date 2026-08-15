import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { QuotesModule } from '../quotes/quotes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RatesModule } from '../rates/rates.module';
import { PasswordModule } from '../auth/password.module';
import { CounterService } from './counter.service';
import { ExchangeExecutor } from './exchange-executor';
import { ReceiptsService } from './receipts.service';
import { TransactionStateMachine } from './transaction-state-machine';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    RatesModule,
    QuotesModule,
    RealtimeModule,
    PasswordModule,
    MulterModule.register({ storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    ReceiptsService,
    CounterService,
    ExchangeExecutor,
    TransactionStateMachine,
  ],
  exports: [TransactionsService, TransactionStateMachine],
})
export class TransactionsModule {}
