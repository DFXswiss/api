import { Module } from '@nestjs/common';
import { RealUnitBlockchainModule } from 'src/integration/blockchain/realunit/realunit-blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PricingModule } from '../pricing/pricing.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitService } from './realunit.service';

@Module({
  imports: [SharedModule, PricingModule, RealUnitBlockchainModule, UserModule, KycModule],
  controllers: [RealUnitController],
  providers: [RealUnitService],
  exports: [RealUnitService],
})
export class RealUnitModule {}
