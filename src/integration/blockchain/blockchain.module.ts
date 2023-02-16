import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { BscModule } from './bsc/bsc.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { OptimismModule } from './optimism/optimism.module';
import { EvmClientRegistryService } from './shared/evm/evm-client-registry.service';

@Module({
  imports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule],
  providers: [EvmClientRegistryService],
  exports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule, EvmClientRegistryService],
})
export class BlockchainModule {}
