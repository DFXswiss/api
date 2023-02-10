import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { StakingModule } from 'src/subdomains/core/staking/staking.module';
import { DepositController } from './deposit/deposit.controller';
import { DepositRepository } from './deposit/deposit.repository';
import { DepositService } from './deposit/deposit.service';
import { DepositRouteRepository } from './route/deposit-route.repository';
import { RouteController } from './route/route.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DepositRepository, DepositRouteRepository]),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => SellCryptoModule),
    forwardRef(() => StakingModule),
    SharedModule,
  ],
  controllers: [RouteController, DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class AddressPoolModule {}
