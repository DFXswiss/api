import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { BscModule } from './bsc/bsc.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { OptimismModule } from './optimism/optimism.module';
import { EvmRegistryService } from './shared/evm/evm-registry.service';

@Module({
  providers: [EvmRegistryService],
  imports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule],
  exports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule, EvmRegistryService],
})
export class BlockchainModule {}
