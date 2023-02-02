import { Module } from '@nestjs/common';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { LetterModule } from 'src/integration/letter/letter.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { StakingModule } from 'src/subdomains/core/staking/staking.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { UserModule } from '../user/user.module';
import { GsEvmController } from './gs-evm.controller';
import { GsEvmService } from './gs-evm.service';
import { GsController } from './gs.controller';
import { GsService } from './gs.service';

@Module({
  imports: [
    SharedModule,
    BlockchainModule,
    ReferralModule,
    BuyCryptoModule,
    SellCryptoModule,
    StakingModule,
    NotificationModule,
    UserModule,
    LetterModule,
    BankModule,
    PayInModule,
  ],
  controllers: [GsController, GsEvmController],
  providers: [GsService, GsEvmService],
  exports: [],
})
export class GsModule {}
