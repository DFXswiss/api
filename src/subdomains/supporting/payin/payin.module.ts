import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { PayInFactory } from './factories/payin.factory';
import { PayInRepository } from './repositories/payin.repository';
import { PayInArbitrumService } from './services/payin-arbitrum.service';
import { PayInBitcoinService } from './services/payin-bitcoin.service';
import { PayInBscService } from './services/payin-bsc.service';
import { PayInDeFiChainService } from './services/payin-defichain.service';
import { PayInEthereumService } from './services/payin-ethereum.service';
import { PayInOptimismService } from './services/payin-optimism.service';
import { PayInService } from './services/payin.service';

@Module({
  imports: [TypeOrmModule.forFeature([PayInRepository]), BlockchainModule, SharedModule],
  controllers: [],
  providers: [
    PayInService,
    PayInFactory,
    PayInArbitrumService,
    PayInBscService,
    PayInEthereumService,
    PayInOptimismService,
    PayInBitcoinService,
    PayInDeFiChainService,
  ],
  exports: [PayInService],
})
export class PayInModule {}
