import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RatesGateway } from './rates.gateway';
import { TransactionsGateway } from './transactions.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [RatesGateway, TransactionsGateway],
  exports: [RatesGateway, TransactionsGateway],
})
export class RealtimeModule {}
