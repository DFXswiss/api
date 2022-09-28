import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { BscModule } from 'src/blockchain/bsc/bsc.module';
import { EthereumModule } from 'src/blockchain/ethereum/ethereum.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../dex/dex.module';
import { PayoutOrderFactory } from './factories/payout-order.factory';
import { PayoutOrderRepository } from './repositories/payout-order.repository';
import { PayoutBscService } from './services/payout-bsc.service';
import { PayoutDeFiChainService } from './services/payout-defichain.service';
import { PayoutEthereumService } from './services/payout-ethereum.service';
import { PayoutLogService } from './services/payout-log.service';
import { PayoutService } from './services/payout.service';
import { PayoutBscCryptoStrategy } from './strategies/payout/payout-bsc-crypto.strategy';
import { PayoutDeFiChainDFIStrategy } from './strategies/payout/payout-defichain-dfi.strategy';
import { PayoutEthereumCryptoStrategy } from './strategies/payout/payout-ethereum-crypto.strategy';
import { PayoutDeFiChainTokenStrategy } from './strategies/payout/payout-defichain-token.strategy';
import { PrepareBscStrategy } from './strategies/prepare/prepare-bsc.strategy';
import { PrepareDeFiChainStrategy } from './strategies/prepare/prepare-defichain.strategy';
import { PrepareEthereumStrategy } from './strategies/prepare/prepare-ethereum.strategy';
import { PayoutStrategiesFacade } from './strategies/strategies.facade';
import { PayoutBitcoinService } from './services/payout-bitcoin.service';
import { PayoutBitcoinStrategy } from './strategies/payout/payout-bitcoin.strategy';
import { PayoutBscTokenStrategy } from './strategies/payout/payout-bsc-token.strategy';
import { PayoutEthereumTokenStrategy } from './strategies/payout/payout-ethereum-token.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayoutOrderRepository]),
    AinModule,
    EthereumModule,
    BscModule,
    SharedModule,
    DexModule,
  ],
  controllers: [],
  providers: [
    PayoutOrderFactory,
    PayoutLogService,
    PayoutService,
    PayoutBitcoinService,
    PayoutDeFiChainService,
    PayoutEthereumService,
    PayoutBscService,
    PayoutBitcoinStrategy,
    PayoutBscCryptoStrategy,
    PayoutBscTokenStrategy,
    PayoutDeFiChainDFIStrategy,
    PayoutDeFiChainTokenStrategy,
    PayoutEthereumCryptoStrategy,
    PayoutEthereumTokenStrategy,
    PrepareDeFiChainStrategy,
    PrepareEthereumStrategy,
    PrepareBscStrategy,
    PayoutStrategiesFacade,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
