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
import { PayoutStrategiesFacade } from './strategies/payout/payout.facade';
import { PayoutBitcoinService } from './services/payout-bitcoin.service';
import { PrepareStrategiesFacade } from './strategies/prepare/prepare.facade';
import { BitcoinStrategy as BitcoinStrategyPO } from './strategies/payout/impl/bitcoin.strategy';
import { BscCryptoStrategy as BscCryptoStrategyPO } from './strategies/payout/impl/bsc-crypto.strategy';
import { BscTokenStrategy as BscTokenStrategyPO } from './strategies/payout/impl/bsc-token.strategy';
import { DeFiChainDfiStrategy as DeFiChainDfiStrategyPO } from './strategies/payout/impl/defichain-dfi.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategyPO } from './strategies/payout/impl/defichain-token.strategy';
import { EthereumCryptoStrategy as EthereumCryptoStrategyPO } from './strategies/payout/impl/ethereum-crypto.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPO } from './strategies/payout/impl/ethereum-token.strategy';
import { BscStrategy as BscStrategyPR } from './strategies/prepare/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyPR } from './strategies/prepare/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyPR } from './strategies/prepare/impl/ethereum.strategy';

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
    PayoutStrategiesFacade,
    PrepareStrategiesFacade,
    BitcoinStrategyPO,
    BscCryptoStrategyPO,
    BscTokenStrategyPO,
    DeFiChainDfiStrategyPO,
    DeFiChainTokenStrategyPO,
    EthereumCryptoStrategyPO,
    EthereumTokenStrategyPO,
    BscStrategyPR,
    DeFiChainStrategyPR,
    EthereumStrategyPR,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
