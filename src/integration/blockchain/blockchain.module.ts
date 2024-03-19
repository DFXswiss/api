import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { LightningModule } from '../lightning/lightning.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { BaseModule } from './base/base.module';
import { BscModule } from './bsc/bsc.module';
import { Ebel2xModule } from './ebel2x/ebel2x.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { FrankencoinModule } from './frankencoin/frankencoin.module';
import { MoneroModule } from './monero/monero.module';
import { OptimismModule } from './optimism/optimism.module';
import { PolygonModule } from './polygon/polygon.module';
import { EvmRegistryService } from './shared/evm/evm-registry.service';
import { CryptoService } from './shared/services/crypto.service';

@Module({
  providers: [EvmRegistryService, CryptoService],
  imports: [
    AinModule,
    BscModule,
    EthereumModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    LightningModule,
    MoneroModule,
    FrankencoinModule,
    Ebel2xModule,
  ],
  exports: [
    AinModule,
    BscModule,
    EthereumModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    LightningModule,
    MoneroModule,
    FrankencoinModule,
    Ebel2xModule,
    EvmRegistryService,
    CryptoService,
  ],
})
export class BlockchainModule {}
