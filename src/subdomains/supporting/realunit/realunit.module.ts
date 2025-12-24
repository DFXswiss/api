import { forwardRef, Module } from '@nestjs/common';
import { RealUnitBlockchainModule } from 'src/integration/blockchain/realunit/realunit-blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from '../bank/bank.module';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitService } from './realunit.service';

@Module({
  imports: [
    SharedModule,
    PricingModule,
    RealUnitBlockchainModule,
    UserModule,
    KycModule,
    BankModule,
    PaymentModule,
    forwardRef(() => BuyCryptoModule),
  ],
  controllers: [RealUnitController],
  providers: [RealUnitService],
  exports: [RealUnitService],
})
export class RealUnitModule {}
