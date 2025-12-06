import { Module } from '@nestjs/common';
import { RealUnitBlockchainModule } from 'src/integration/blockchain/realunit/realunit-blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitApiKeyGuard } from './guards/realunit-api-key.guard';
import { RealUnitService } from './realunit.service';
import { RealUnitRegistrationService } from './services/realunit-registration.service';

@Module({
  imports: [SharedModule, PricingModule, RealUnitBlockchainModule],
  controllers: [RealUnitController],
  providers: [RealUnitService, RealUnitRegistrationService, RealUnitApiKeyGuard],
  exports: [RealUnitService, RealUnitRegistrationService],
})
export class RealUnitModule {}
