import { Module } from '@nestjs/common';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { SharedModule } from 'src/shared/shared.module';
import { LightningModule } from '../lightning/lightning.module';
import { RailgunModule } from '../railgun/railgun.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { ArweaveModule } from './arweave/arweave.module';
import { BlockchainApiModule } from './api/blockchain-api.module';
import { BaseModule } from './base/base.module';
import { BscModule } from './bsc/bsc.module';
import { CitreaTestnetModule } from './citrea-testnet/citrea-testnet.module';
import { DEuroModule } from './deuro/deuro.module';
import { Ebel2xModule } from './ebel2x/ebel2x.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { FrankencoinModule } from './frankencoin/frankencoin.module';
import { GnosisModule } from './gnosis/gnosis.module';
import { MoneroModule } from './monero/monero.module';
import { OptimismModule } from './optimism/optimism.module';
import { PolygonModule } from './polygon/polygon.module';
import { RealUnitBlockchainModule } from './realunit/realunit-blockchain.module';
import { SepoliaModule } from './sepolia/sepolia.module';
import { Eip7702DelegationModule } from './shared/evm/delegation/eip7702-delegation.module';
import { EvmDecimalsService } from './shared/evm/evm-decimals.service';
import { BlockchainRegistryService } from './shared/services/blockchain-registry.service';
import { CryptoService } from './shared/services/crypto.service';
import { TxValidationService } from './shared/services/tx-validation.service';
import { SolanaModule } from './solana/solana.module';
import { SparkModule } from './spark/spark.module';
import { TronModule } from './tron/tron.module';
import { CardanoModule } from './cardano/cardano.module';
import { ZanoModule } from './zano/zano.module';

@Module({
  providers: [EvmDecimalsService, CryptoService, BlockchainRegistryService, TxValidationService],
  imports: [
    SharedModule,
    BitcoinModule,
    BscModule,
    EthereumModule,
    SepoliaModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    LightningModule,
    SparkModule,
    MoneroModule,
    ZanoModule,
    FrankencoinModule,
    DEuroModule,
    Ebel2xModule,
    ArweaveModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CardanoModule,
    CitreaTestnetModule,
    RealUnitBlockchainModule,
    Eip7702DelegationModule,
    BlockchainApiModule,
  ],
  exports: [
    BitcoinModule,
    BscModule,
    EthereumModule,
    SepoliaModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    LightningModule,
    SparkModule,
    MoneroModule,
    ZanoModule,
    FrankencoinModule,
    DEuroModule,
    Ebel2xModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CardanoModule,
    CitreaTestnetModule,
    CryptoService,
    BlockchainRegistryService,
    TxValidationService,
    RealUnitBlockchainModule,
    Eip7702DelegationModule,
    BlockchainApiModule,
  ],
})
export class BlockchainModule {}
