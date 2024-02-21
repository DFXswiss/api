import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { PaymentModule } from 'src/subdomains/supporting/payment/payment.module';
import { DexModule } from '../dex/dex.module';
import { NotificationModule } from '../notification/notification.module';
import { PayoutModule } from '../payout/payout.module';
import { PricingModule } from '../pricing/pricing.module';
import { CryptoInput } from './entities/crypto-input.entity';
import { PayInFactory } from './factories/payin.factory';
import { PayInRepository } from './repositories/payin.repository';
import { PayInArbitrumService } from './services/payin-arbitrum.service';
import { PayInBaseService } from './services/payin-base.service';
import { PayInBitcoinService } from './services/payin-bitcoin.service';
import { PayInBscService } from './services/payin-bsc.service';
import { PayInDeFiChainService } from './services/payin-defichain.service';
import { PayInEthereumService } from './services/payin-ethereum.service';
import { PayInMoneroService } from './services/payin-monero.service';
import { PayInNotificationService } from './services/payin-notification.service';
import { PayInOptimismService } from './services/payin-optimism.service';
import { PayInPolygonService } from './services/payin-polygon.service';
import { PayInService } from './services/payin.service';
import { ArbitrumStrategy as ArbitrumStrategyR } from './strategies/register/impl/arbitrum.strategy';
import { BaseStrategy as BaseStrategyR } from './strategies/register/impl/base.strategy';
import { RegisterStrategyRegistry } from './strategies/register/impl/base/register.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyR } from './strategies/register/impl/bitcoin.strategy';
import { BscStrategy as BscStrategyR } from './strategies/register/impl/bsc.strategy';
import { DeFiChainStrategy as DeFiChainStrategyR } from './strategies/register/impl/defichain.strategy';
import { EthereumStrategy as EthereumStrategyR } from './strategies/register/impl/ethereum.strategy';
import { LightningStrategy as LightningStrategyR } from './strategies/register/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyR } from './strategies/register/impl/monero.strategy';
import { OptimismStrategy as OptimismStrategyR } from './strategies/register/impl/optimism.strategy';
import { PolygonStrategy as PolygonStrategyR } from './strategies/register/impl/polygon.strategy';
import { ArbitrumCoinStrategy as ArbitrumCoinStrategyS } from './strategies/send/impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy as ArbitrumTokenStrategyS } from './strategies/send/impl/arbitrum-token.strategy';
import { BaseCoinStrategy as BaseCoinStrategyS } from './strategies/send/impl/base-coin.strategy';
import { BaseTokenStrategy as BaseTokenStrategyS } from './strategies/send/impl/base-token.strategy';
import { SendStrategyRegistry } from './strategies/send/impl/base/send.strategy-registry';
import { BitcoinStrategy as BitcoinStrategyS } from './strategies/send/impl/bitcoin.strategy';
import { BscCoinStrategy as BscCoinStrategyS } from './strategies/send/impl/bsc-coin.strategy';
import { BscTokenStrategy as BscTokenStrategyS } from './strategies/send/impl/bsc-token.strategy';
import { DeFiChainCoinStrategy as DeFiChainCoinStrategyS } from './strategies/send/impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy as DeFiChainTokenStrategyS } from './strategies/send/impl/defichain-token.strategy';
import { EthereumCoinStrategy as EthereumCoinStrategyS } from './strategies/send/impl/ethereum-coin.strategy';
import { EthereumTokenStrategy as EthereumTokenStrategyS } from './strategies/send/impl/ethereum-token.strategy';
import { LightningStrategy as LightningStrategyS } from './strategies/send/impl/lightning.strategy';
import { MoneroStrategy as MoneroStrategyS } from './strategies/send/impl/monero.strategy';
import { OptimismCoinStrategy as OptimismCoinStrategyS } from './strategies/send/impl/optimism-coin.strategy';
import { OptimismTokenStrategy as OptimismTokenStrategyS } from './strategies/send/impl/optimism-token.strategy';
import { PolygonCoinStrategy as PolygonCoinStrategyS } from './strategies/send/impl/polygon-coin.strategy';
import { PolygonTokenStrategy as PolygonTokenStrategyS } from './strategies/send/impl/polygon-token.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([CryptoInput]),
    BlockchainModule,
    SharedModule,
    PricingModule,
    PayoutModule,
    DexModule,
    forwardRef(() => SellCryptoModule),
    forwardRef(() => PaymentModule),
    NotificationModule,
    AlchemyModule,
  ],
  controllers: [],
  providers: [
    PayInRepository,
    PayInService,
    PayInFactory,
    PayInNotificationService,
    PayInBitcoinService,
    PayInMoneroService,
    PayInDeFiChainService,
    PayInEthereumService,
    PayInBscService,
    PayInArbitrumService,
    PayInOptimismService,
    PayInPolygonService,
    PayInBaseService,
    RegisterStrategyRegistry,
    SendStrategyRegistry,
    BitcoinStrategyR,
    BitcoinStrategyS,
    LightningStrategyR,
    LightningStrategyS,
    MoneroStrategyR,
    MoneroStrategyS,
    DeFiChainStrategyR,
    DeFiChainCoinStrategyS,
    DeFiChainTokenStrategyS,
    EthereumStrategyR,
    EthereumCoinStrategyS,
    EthereumTokenStrategyS,
    BscStrategyR,
    BscCoinStrategyS,
    BscTokenStrategyS,
    ArbitrumStrategyR,
    ArbitrumCoinStrategyS,
    ArbitrumTokenStrategyS,
    OptimismStrategyR,
    OptimismCoinStrategyS,
    OptimismTokenStrategyS,
    PolygonStrategyR,
    PolygonCoinStrategyS,
    PolygonTokenStrategyS,
    BaseStrategyR,
    BaseCoinStrategyS,
    BaseTokenStrategyS,
  ],
  exports: [PayInService],
})
export class PayInModule {}
