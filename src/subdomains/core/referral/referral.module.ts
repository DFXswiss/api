import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { LiquidityManagementModule } from 'src/subdomains/core/liquidity-management/liquidity-management.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { RefController } from './process/ref.controller';
import { Ref } from './process/ref.entity';
import { RefRepository } from './process/ref.repository';
import { RefService } from './process/ref.service';
import { RefRewardController } from './reward/ref-reward.controller';
import { RefReward } from './reward/ref-reward.entity';
import { RefRewardRepository } from './reward/ref-reward.repository';
import { RefRewardDexService } from './reward/services/ref-reward-dex.service';
import { RefRewardJobService } from './reward/services/ref-reward-job.service';
import { RefRewardNotificationService } from './reward/services/ref-reward-notification.service';
import { RefRewardOutService } from './reward/services/ref-reward-out.service';
import { RefRewardService } from './reward/services/ref-reward.service';

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
    forwardRef(() => TransactionModule),
    LiquidityManagementModule,
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
    RefRewardJobService,
  ],
  exports: [RefService, RefRewardService],
})
export class ReferralModule {}
