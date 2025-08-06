import { Module } from '@nestjs/common';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { SharedModule } from 'src/shared/shared.module';
import { LightningModule } from '../lightning/lightning.module';
import { RailgunModule } from '../railgun/railgun.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { ArweaveModule } from './arweave/arweave.module';
import { BaseModule } from './base/base.module';
import { BscModule } from './bsc/bsc.module';
import { DEuroModule } from './deuro/deuro.module';
import { Ebel2xModule } from './ebel2x/ebel2x.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { FrankencoinModule } from './frankencoin/frankencoin.module';
import { GnosisModule } from './gnosis/gnosis.module';
import { MoneroModule } from './monero/monero.module';
import { OptimismModule } from './optimism/optimism.module';
import { PolygonModule } from './polygon/polygon.module';
import { EvmDecimalsService } from './shared/evm/evm-decimals.service';
import { BlockchainRegistryService } from './shared/services/blockchain-registry.service';
import { CryptoService } from './shared/services/crypto.service';
import { SolanaModule } from './solana/solana.module';
import { TronModule } from './tron/tron.module';
import { ZanoModule } from './zano/zano.module';
import { CitreaTestnetModule } from './citrea-testnet/citrea-testnet.module';

@Module({
  providers: [EvmDecimalsService, CryptoService, BlockchainRegistryService],
  imports: [
    SharedModule,
    BitcoinModule,
    BscModule,
    EthereumModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    LightningModule,
    MoneroModule,
    ZanoModule,
    FrankencoinModule,
    DEuroModule,
    Ebel2xModule,
    ArweaveModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CitreaTestnetModule,
  ],
  exports: [
    BitcoinModule,
    BscModule,
    EthereumModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    LightningModule,
    MoneroModule,
    ZanoModule,
    FrankencoinModule,
    DEuroModule,
    Ebel2xModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CitreaTestnetModule,
    CryptoService,
    BlockchainRegistryService,
  ],
})
export class BlockchainModule {}
