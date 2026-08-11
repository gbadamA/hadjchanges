import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';

@Module({
  controllers: [CurrenciesController],
})
export class CurrenciesModule {}
