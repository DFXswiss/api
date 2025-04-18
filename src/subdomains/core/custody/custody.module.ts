import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { DfxOrderStepAdapter } from './adapter/dfx-order-step.adapter';
import { CustodyAdminController, CustodyController } from './controllers/custody.controller';
import { CustodyBalance } from './entities/custody-balance.entity';
import { CustodyOrderStep } from './entities/custody-order-step.entity';
import { CustodyOrder } from './entities/custody-order.entity';
import { CustodyBalanceRepository } from './repositories/custody-balance.repository';
import { CustodyOrderStepRepository } from './repositories/custody-order-step.repository';
import { CustodyOrderRepository } from './repositories/custody-order.repository';
import { CustodyJobService } from './services/custody-job.service';
import { CustodyOrderService } from './services/custody-order.service';
import { CustodyService } from './services/custody.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustodyOrder, CustodyOrderStep]),
    forwardRef(() => UserModule),
    ReferralModule,
    SharedModule,
    forwardRef(() => SellCryptoModule),
    forwardRef(() => BuyCryptoModule),
    BlockchainModule,
    PricingModule,
  ],
  controllers: [CustodyController, CustodyAdminController],
  providers: [
    CustodyService,
    CustodyOrderRepository,
    CustodyOrderStepRepository,
    DfxOrderStepAdapter,
    CustodyOrderService,
    CustodyJobService,
    CustodyBalance,
    CustodyBalanceRepository,
  ],
  exports: [CustodyService, CustodyOrderService],
})
export class CustodyModule {}
