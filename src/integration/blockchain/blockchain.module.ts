import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { BlockchainService } from './blockchain.service';
import { BscModule } from './bsc/bsc.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { OptimismModule } from './optimism/optimism.module';

@Module({
  imports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule],
  controllers: [],
  providers: [BlockchainService],
  exports: [BlockchainService, AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule],
})
export class BlockchainModule {}
