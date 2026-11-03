import { Module } from '@nestjs/common';
import { QuotesModule } from '../quotes/quotes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RatesModule } from '../rates/rates.module';
import { PasswordModule } from '../auth/password.module';
import { CounterService } from './counter.service';
import { ExchangeExecutor } from './exchange-executor';
import { PaymentProofService } from './payment-proof.service';
import { TransactionStateMachine } from './transaction-state-machine';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    RatesModule,
    QuotesModule,
    RealtimeModule,
    PasswordModule,
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    PaymentProofService,
    CounterService,
    ExchangeExecutor,
    TransactionStateMachine,
  ],
  exports: [TransactionsService, TransactionStateMachine],
})
export class TransactionsModule {}
