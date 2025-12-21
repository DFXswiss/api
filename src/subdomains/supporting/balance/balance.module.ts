import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from '../pricing/pricing.module';
import { BalanceController } from './controllers/balance.controller';
import { BalancePdfService } from './services/balance-pdf.service';

@Module({
  imports: [SharedModule, AlchemyModule, PricingModule],
  controllers: [BalanceController],
  providers: [BalancePdfService],
  exports: [BalancePdfService],
})
export class BalanceModule {}
