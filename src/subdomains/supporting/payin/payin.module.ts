import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayInFactory } from './factories/payin.factory';
import { PayInRepository } from './repositories/payin.repository';
import { PayInArbitrumService } from './services/payin-arbitrum.service';
import { PayInBscService } from './services/payin-bsc.service';
import { PayInEthereumService } from './services/payin-ethereum.service';
import { PayInOptimismService } from './services/payin-optimism.service';
import { PayInService } from './services/payin.service';
import { ArbitrumStrategy } from './strategies/arbitrum.strategy';
import { BscStrategy } from './strategies/bsc.strategy';
import { DeFiChainStrategy } from './strategies/defichain.strategy';
import { EthereumStrategy } from './strategies/ethereum.strategy';
import { OptimismStrategy } from './strategies/optimism.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayInRepository]), BlockchainModule, SharedModule],
  controllers: [],
  providers: [
    PayInService,
    DeFiChainStrategy,
    PayInFactory,
    PayInArbitrumService,
    PayInBscService,
    PayInEthereumService,
    PayInOptimismService,
    ArbitrumStrategy,
    BscStrategy,
    EthereumStrategy,
    OptimismStrategy,
  ],
  exports: [PayInService],
})
export class PayInModule {}
