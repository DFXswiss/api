import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { TatumModule } from 'src/integration/tatum/tatum.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { DepositController } from './deposit/deposit.controller';
import { Deposit } from './deposit/deposit.entity';
import { DepositRepository } from './deposit/deposit.repository';
import { DepositService } from './deposit/deposit.service';
import { DepositRoute } from './route/deposit-route.entity';
import { DepositRouteRepository } from './route/deposit-route.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Deposit, DepositRoute]),
    forwardRef(() => BuyCryptoModule),
    forwardRef(() => SellCryptoModule),
    SharedModule,
    BlockchainModule,
    AlchemyModule,
    TatumModule,
  ],
  controllers: [DepositController],
  providers: [DepositRepository, DepositRouteRepository, DepositService],
  exports: [DepositService],
})
export class AddressPoolModule {}
