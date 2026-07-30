import { Module } from '@nestjs/common';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { PartnerStatisticController } from './partner-statistic.controller';
import { PartnerStatisticService } from './partner-statistic.service';
import { StatisticController } from './statistic.controller';
import { StatisticService } from './statistic.service';

@Module({
  imports: [SharedModule, BuyCryptoModule, SellCryptoModule, ReferralModule, UserModule, BitcoinModule],
  controllers: [StatisticController, PartnerStatisticController],
  providers: [
    StatisticService,
    PartnerStatisticService,
    // Repositories not re-exported by every parent module — same pattern as FiatOutputModule.
    BuyCryptoRepository,
    BuyFiatRepository,
    UserRepository,
    WalletRepository,
  ],
  exports: [],
})
export class StatisticModule {}
