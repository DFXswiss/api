import { Module } from '@nestjs/common';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [],
  controllers: [],
  providers: [PricingService],
  exports: [],
})
export class PricingModule {}
