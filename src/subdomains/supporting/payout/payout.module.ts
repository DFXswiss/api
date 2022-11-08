import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { BscCoinStrategy as BscCryptoStrategyPO } from './strategies/payout/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyPO } from './strategies/payout/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainDfiStrategyPO } from './strategies/payout/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategyPO } from './strategies/payout/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCryptoStrategyPO } from './strategies/payout/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyPO } from './strategies/payout/impl/ethereum-token.strategy';
import { BitcoinStrategy as BitcoinStrategyPR } from './strategies/prepare/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyPR } from './strategies/prepare/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyPR } from './strategies/prepare/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyPR } from './strategies/prepare/impl/ethereum.strategy';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayoutController } from './payout.controller';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayoutOrderRepository]),
    BlockchainModule,
    SharedModule,
    DexModule,
    NotificationModule,
  ],
  controllers: [PayoutController],
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
    BitcoinStrategyPR,
    BscStrategyPR,
    DeFiChainStrategyPR,
    EthereumStrategyPR,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
