import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { LightningModule } from '../lightning/lightning.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { BscModule } from './bsc/bsc.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { OptimismModule } from './optimism/optimism.module';
import { EvmRegistryService } from './shared/evm/evm-registry.service';
import { CryptoService } from './shared/services/crypto.service';

@Module({
  providers: [EvmRegistryService, CryptoService],
  imports: [AinModule, BscModule, EthereumModule, OptimismModule, ArbitrumModule, LightningModule],
  exports: [
    AinModule,
    BscModule,
    EthereumModule,
    OptimismModule,
    ArbitrumModule,
    EvmRegistryService,
    LightningModule,
    CryptoService,
  ],
})
export class BlockchainModule {}
