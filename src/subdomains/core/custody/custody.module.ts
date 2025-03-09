import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { DfxOrderStepAdapter } from './adapter/dfx-order-step.adapter';
import { CustodyAdminController, CustodyController } from './controllers/custody.controller';
import { CustodyOrderStep } from './entities/custody-order-step.entity';
import { CustodyOrder } from './entities/custody-order.entity';
import { CustodyOrderStepRepository } from './repositories/custody-order.-step.repository';
import { CustodyOrderRepository } from './repositories/custody-order.repository';
import { CustodyService } from './services/custody-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustodyOrder, CustodyOrderStep]),
    UserModule,
    ReferralModule,
    SharedModule,
    SellCryptoModule,
    BuyCryptoModule,
    BlockchainModule,
  ],
  controllers: [CustodyController, CustodyAdminController],
  providers: [CustodyService, CustodyOrderRepository, CustodyOrderStepRepository, DfxOrderStepAdapter],
  exports: [CustodyService],
})
export class CustodyModule {}
