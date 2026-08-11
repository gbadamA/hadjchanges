import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { RatesController } from './rates.controller';
import { RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

@Module({
  imports: [RealtimeModule],
  controllers: [RatesController],
  providers: [RatesService, RatesRepository],
  exports: [RatesService, RatesRepository],
})
export class RatesModule {}
