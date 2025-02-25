import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BuyCryptoModule } from '../buy-crypto/buy-crypto.module';
import { ReferralModule } from '../referral/referral.module';
import { SellCryptoModule } from '../sell-crypto/sell-crypto.module';
import { CustodyController } from './controllers/custody.controller';
import { CustodyActionOrder } from './entities/custofy-action-order.entity';
import { CustodyActionOrderRepository } from './repositories/custody-action-order.repository';
import { CustodyService } from './services/custody-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustodyActionOrder]),
    UserModule,
    ReferralModule,
    SharedModule,
    SellCryptoModule,
    BuyCryptoModule,
  ],
  controllers: [CustodyController],
  providers: [CustodyService, CustodyActionOrderRepository],
  exports: [CustodyService],
})
export class CustodyModule {}
