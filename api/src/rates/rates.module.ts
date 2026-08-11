import { Module } from '@nestjs/common';
import { RatesController } from './rates.controller';
import { RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

@Module({
  controllers: [RatesController],
  providers: [RatesService, RatesRepository],
  exports: [RatesService, RatesRepository],
})
export class RatesModule {}
