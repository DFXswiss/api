import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { CustodyAdminController, CustodyController } from './controllers/custody.controller';
import { CustodyOrder } from './entities/custody-order.entity';
import { CustodyOrderRepository } from './repositories/custody-order.repository';
import { CustodyService } from './services/custody-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustodyOrder]),
    UserModule,
    ReferralModule,
    SharedModule,
    SellCryptoModule,
    BuyCryptoModule,
  ],
  controllers: [CustodyController, CustodyAdminController],
  providers: [CustodyService, CustodyOrderRepository],
  exports: [CustodyService],
})
export class CustodyModule {}
