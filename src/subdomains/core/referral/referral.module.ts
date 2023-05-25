import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { RefController } from './process/ref.controller';
import { Ref } from './process/ref.entity';
import { RefRepository } from './process/ref.repository';
import { RefService } from './process/ref.service';
import { RefRewardController } from './reward/ref-reward.controller';
import { RefReward } from './reward/ref-reward.entity';
import { RefRewardRepository } from './reward/ref-reward.repository';
import { RefRewardService } from './reward/ref-reward.service';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { RefRewardNotificationService } from './reward/ref-reward-notification.service';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { RefRewardDexService } from './reward/ref-reward-dex.service';
import { RefRewardOutService } from './reward/ref-reward-out.service';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ref, RefReward]),
    SharedModule,
    forwardRef(() => UserModule),
    BlockchainModule,
    DexModule,
    PayoutModule,
    NotificationModule,
    PricingModule,
  ],
  controllers: [RefController, RefRewardController],
  providers: [
    RefRepository,
    RefRewardRepository,
    RefService,
    RefRewardService,
    RefRewardNotificationService,
    RefRewardDexService,
    RefRewardOutService,
  ],
  exports: [RefService, RefRewardService],
})
export class ReferralModule {}
