import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { CryptoInputRepository } from './models/crypto-input/crypto-input.repository';
import { CryptoInputService } from './models/crypto-input/crypto-input.service';
import { DepositRepository } from './models/deposit/deposit.repository';
import { DepositService } from './models/deposit/deposit.service';
import { StakingController } from './models/staking/staking.controller';
import { StakingRepository } from './models/staking/staking.repository';
import { StakingService } from './models/staking/staking.service';
import { MasternodeController } from './models/masternode/masternode.controller';
import { MasternodeService } from './models/masternode/masternode.service';
import { MasternodeRepository } from './models/masternode/masternode.repository';
import { StakingRewardRepository } from './models/staking-reward/staking-reward.repository';
import { StakingRewardController } from './models/staking-reward/staking-reward.controller';
import { StakingRewardService } from './models/staking-reward/staking-reward.service';
import { CryptoStakingService } from './models/crypto-staking/crypto-staking.service';
import { CryptoStakingRepository } from './models/crypto-staking/crypto-staking.repository';
import { CryptoStakingController } from './models/crypto-staking/crypto-staking.controller';
import { CryptoInputController } from './models/crypto-input/crypto-input.controller';
import { StakingRefRewardService } from './models/staking-ref-reward/staking-ref-reward.service';
import { StakingRefRewardRepository } from './models/staking-ref-reward/staking-ref-reward.repository';
import { CryptoRouteController } from './models/crypto-route/crypto-route.controller';
import { CryptoRouteService } from './models/crypto-route/crypto-route.service';
import { CryptoRouteRepository } from './models/crypto-route/crypto-route.repository';
import { BtcInputService } from './models/crypto-input/btc-input.service';
import { DeFiInputService } from './models/crypto-input/defi-input.service';
import { DexModule } from '../subdomains/supporting/dex/dex.module';
import { ChainalysisService } from './models/crypto-input/chainalysis.service';
import { PayoutModule } from '../subdomains/supporting/payout/payout.module';
import { ExchangeModule } from '../integration/exchange/exchange.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { RouteController } from './models/route/route.controller';
import { DepositRouteRepository } from './models/route/deposit-route.repository';
import { DepositController } from './models/deposit/deposit.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CryptoInputRepository,
      StakingRepository,
      DepositRepository,
      DepositRouteRepository,
      MasternodeRepository,
      StakingRewardRepository,
      StakingRefRewardRepository,
      CryptoStakingRepository,
      CryptoRouteRepository,
    ]),
    SharedModule,
    SellCryptoModule,
    BuyCryptoModule,
    AinModule,
    UserModule,
    DexModule,
    PayoutModule,
    PricingModule,
    ExchangeModule,
    NotificationModule,
  ],
  controllers: [
    RouteController,
    StakingController,
    MasternodeController,
    StakingRewardController,
    CryptoStakingController,
    CryptoInputController,
    CryptoRouteController,
    DepositController,
  ],
  providers: [
    StakingController,
    CryptoRouteController,
    CryptoInputService,
    BtcInputService,
    DeFiInputService,
    StakingService,
    DepositService,
    MasternodeService,
    StakingRewardService,
    StakingRefRewardService,
    CryptoStakingService,
    CryptoRouteService,
    ChainalysisService,
  ],
  exports: [
    DepositService,
    StakingRewardService,
    MasternodeService,
    StakingService,
    CryptoInputService,
    CryptoStakingService,
    StakingRefRewardService,
    CryptoRouteService,
  ],
})
export class MixModule {}
