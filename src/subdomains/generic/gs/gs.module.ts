import { Module } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { LetterModule } from 'src/integration/letter/letter.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { FiatOutputModule } from 'src/subdomains/supporting/fiat-output/fiat-output.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { KycModule } from '../kyc/kyc.module';
import { UserModule } from '../user/user.module';
import { GsEvmController } from './gs-evm.controller';
import { GsEvmService } from './gs-evm.service';
import { GsController } from './gs.controller';
import { GsService } from './gs.service';

@Module({
  imports: [
    SharedModule,
    BlockchainModule,
    AddressPoolModule,
    ReferralModule,
    BuyCryptoModule,
    SellCryptoModule,
    NotificationModule,
    UserModule,
    LetterModule,
    BankTxModule,
    PayInModule,
    FiatOutputModule,
    KycModule,
    TransactionModule,
    SupportIssueModule,
    BankModule,
  ],
  controllers: [GsController, GsEvmController],
  providers: [GsService, GsEvmService],
  exports: [],
})
export class GsModule {}
