import { Module } from '@nestjs/common';
import { RatesModule } from '../rates/rates.module';
import { QuoteCalculator } from './quote-calculator';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [RatesModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuoteCalculator],
  exports: [QuotesService, QuoteCalculator],
})
export class QuotesModule {}
