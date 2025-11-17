import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitService } from './realunit.service';

@Module({
  imports: [SharedModule, PricingModule],
  controllers: [RealUnitController],
  providers: [RealUnitService],
  exports: [RealUnitService],
})
export class RealUnitModule {}
