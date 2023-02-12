import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { ExchangeModule } from 'src/integration/exchange/exchange.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { CryptoStakingController } from './controllers/crypto-staking.controller';
import { StakingController } from './controllers/staking.controller';
import { CryptoStakingRepository } from './repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from './repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from './repositories/staking-reward.repository';
import { StakingRepository } from './repositories/staking.repository';
import { CryptoStakingService } from './services/crypto-staking.service';
import { StakingRefRewardService } from './services/staking-ref-reward.service';
import { StakingReturnService } from './services/staking-return.service';
import { StakingRewardService } from './services/staking-reward.service';
import { StakingService } from './services/staking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StakingRepository,
      StakingRewardRepository,
      StakingRefRewardRepository,
      CryptoStakingRepository,
    ]),
    SharedModule,
    UserModule,
    AinModule,
    ExchangeModule,
    forwardRef(() => PricingModule),
    forwardRef(() => SellCryptoModule),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => PayInModule),
    NotificationModule,
  ],
  controllers: [StakingController, CryptoStakingController],
  providers: [
    StakingController,
    StakingService,
    StakingReturnService,
    CryptoStakingService,
    StakingRefRewardService,
    StakingRewardService,
  ],
  exports: [StakingController, StakingService, StakingRewardService, CryptoStakingService, StakingRefRewardService],
})
export class StakingModule {}
