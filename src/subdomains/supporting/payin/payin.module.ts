import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { ChainalysisModule } from 'src/integration/chainalysis/chainalysis.module';
import { SharedModule } from 'src/shared/shared.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { DexModule } from '../dex/dex.module';
import { PayoutModule } from '../payout/payout.module';
import { PricingModule } from '../pricing/pricing.module';
import { CryptoInput } from './entities/crypto-input.entity';
import { PayInFactory } from './factories/payin.factory';
import { PayInRepository } from './repositories/payin.repository';
import { PayInArbitrumService } from './services/payin-arbitrum.service';
import { PayInBitcoinService } from './services/payin-bitcoin.service';
import { PayInBscService } from './services/payin-bsc.service';
import { PayInDeFiChainService } from './services/payin-defichain.service';
import { PayInEthereumService } from './services/payin-ethereum.service';
import { PayInOptimismService } from './services/payin-optimism.service';
import { PayInService } from './services/payin.service';
import { ArbitrumStrategy as ArbitrumStrategyR } from './strategies/register/impl/arbitrum.strategy';
import { BitcoinStrategy as BitcoinStrategyR } from './strategies/register/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyR } from './strategies/register/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyR } from './strategies/register/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyR } from './strategies/register/impl/ethereum.strategy';
import { OptimismStrategy as OptimismStrategyR } from './strategies/register/impl/optimism.strategy';
import { LightningStrategy as LightningStrategyR } from './strategies/register/impl/lightning.strategy';
import { RegisterStrategiesFacade } from './strategies/register/register.facade';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyS } from './strategies/send/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyS } from './strategies/send/impl/arbitrum-token.strategy';
import { BitcoinStrategy as BitcoinStrategyS } from './strategies/send/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyS } from './strategies/send/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyS } from './strategies/send/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainCoinStrategyS } from './strategies/send/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategyS } from './strategies/send/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyS } from './strategies/send/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyS } from './strategies/send/impl/ethereum-token.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyS } from './strategies/send/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyS } from './strategies/send/impl/optimism-token.strategy';
import { LightningStrategy as LightningStrategyS } from './strategies/send/impl/lightning.strategy';
import { SendStrategiesFacade } from './strategies/send/send.facade';
import { PaymentModule } from 'src/shared/payment/payment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CryptoInput]),
    BlockchainModule,
    SharedModule,
    PricingModule,
    PayoutModule,
    DexModule,
    ChainalysisModule,
    SellCryptoModule,
    PaymentModule,
  ],
  controllers: [],
  providers: [
    PayInRepository,
    PayInService,
    PayInFactory,
    PayInArbitrumService,
    PayInBscService,
    PayInEthereumService,
    PayInOptimismService,
    PayInBitcoinService,
    PayInDeFiChainService,
    SendStrategiesFacade,
    RegisterStrategiesFacade,
    ArbitrumStrategyR,
    BitcoinStrategyR,
    BscStrategyR,
    DeFiChainStrategyR,
    EthereumStrategyR,
    OptimismStrategyR,
    LightningStrategyR,
    ArbitrumCoinStrategyS,
    ArbitrumTokenStrategyS,
    BitcoinStrategyS,
    BscCoinStrategyS,
    BscTokenStrategyS,
    DeFiChainCoinStrategyS,
    DeFiChainTokenStrategyS,
    EthereumCoinStrategyS,
    EthereumTokenStrategyS,
    OptimismCoinStrategyS,
    OptimismTokenStrategyS,
    LightningStrategyS,
  ],
  exports: [PayInService],
})
export class PayInModule {}
