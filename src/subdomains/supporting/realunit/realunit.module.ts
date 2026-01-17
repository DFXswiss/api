import { forwardRef, Module } from '@nestjs/common';
import { RealUnitBlockchainModule } from 'src/integration/blockchain/realunit/realunit-blockchain.module';
import { Eip7702DelegationModule } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BalanceModule } from '../balance/balance.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { BankModule } from '../bank/bank.module';
import { PaymentModule } from '../payment/payment.module';
import { TransactionModule } from '../payment/transaction.module';
import { PricingModule } from '../pricing/pricing.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitDevService } from './realunit-dev.service';
import { RealUnitService } from './realunit.service';

@Module({
  imports: [
    SharedModule,
    PricingModule,
    BalanceModule,
    RealUnitBlockchainModule,
    UserModule,
    KycModule,
    BankModule,
    BankTxModule,
    PaymentModule,
    TransactionModule,
    Eip7702DelegationModule,
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => SellCryptoModule),
  ],
  controllers: [RealUnitController],
  providers: [RealUnitService, RealUnitDevService],
  exports: [RealUnitService],
})
export class RealUnitModule {}
