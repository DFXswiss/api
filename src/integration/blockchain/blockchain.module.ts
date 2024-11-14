import { Module } from '@nestjs/common';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { LightningModule } from '../lightning/lightning.module';
import { RailgunModule } from '../railgun/railgun.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { ArweaveModule } from './arweave/arweave.module';
import { BaseModule } from './base/base.module';
import { BscModule } from './bsc/bsc.module';
import { Ebel2xModule } from './ebel2x/ebel2x.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { FrankencoinModule } from './frankencoin/frankencoin.module';
import { MoneroModule } from './monero/monero.module';
import { OptimismModule } from './optimism/optimism.module';
import { PolygonModule } from './polygon/polygon.module';
import { EvmDecimalsService } from './shared/evm/evm-decimals.service';
import { EvmGasPriceService } from './shared/evm/evm-gas-price.service';
import { EvmRegistryService } from './shared/evm/evm-registry.service';
import { CryptoService } from './shared/services/crypto.service';

@Module({
  providers: [EvmRegistryService, EvmDecimalsService, EvmGasPriceService, CryptoService],
  imports: [
    SharedModule,
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
    ArweaveModule,
    RailgunModule,
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
    RailgunModule,
    EvmRegistryService,
    EvmGasPriceService,
    CryptoService,
  ],
})
export class BlockchainModule {}
