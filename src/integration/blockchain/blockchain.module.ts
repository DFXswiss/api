import { Module } from '@nestjs/common';
import { BitcoinTestnet4Module } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4.module';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { SharedModule } from 'src/shared/shared.module';
import { LightningModule } from '../lightning/lightning.module';
import { RailgunModule } from '../railgun/railgun.module';
import { BlockchainApiModule } from './api/blockchain-api.module';
import { ArbitrumModule } from './arbitrum/arbitrum.module';
import { ArweaveModule } from './arweave/arweave.module';
import { BaseModule } from './base/base.module';
import { BoltzModule } from './boltz/boltz.module';
import { BscModule } from './bsc/bsc.module';
import { CardanoModule } from './cardano/cardano.module';
import { CitreaTestnetModule } from './citrea-testnet/citrea-testnet.module';
import { CitreaModule } from './citrea/citrea.module';
import { ClementineModule } from './clementine/clementine.module';
import { DEuroModule } from './deuro/deuro.module';
import { Ebel2xModule } from './ebel2x/ebel2x.module';
import { EthereumModule } from './ethereum/ethereum.module';
import { FiroModule } from './firo/firo.module';
import { FrankencoinModule } from './frankencoin/frankencoin.module';
import { GnosisModule } from './gnosis/gnosis.module';
import { JuiceModule } from './juice/juice.module';
import { MoneroModule } from './monero/monero.module';
import { OptimismModule } from './optimism/optimism.module';
import { PolygonModule } from './polygon/polygon.module';
import { RealUnitBlockchainModule } from './realunit/realunit-blockchain.module';
import { SepoliaModule } from './sepolia/sepolia.module';
import { Eip7702DelegationModule } from './shared/evm/delegation/eip7702-delegation.module';
import { EvmDecimalsService } from './shared/evm/evm-decimals.service';
import { PimlicoPaymasterModule } from './shared/evm/paymaster/pimlico-paymaster.module';
import { BlockchainRegistryService } from './shared/services/blockchain-registry.service';
import { CryptoService } from './shared/services/crypto.service';
import { TxValidationService } from './shared/services/tx-validation.service';
import { SolanaModule } from './solana/solana.module';
import { SparkModule } from './spark/spark.module';
import { TronModule } from './tron/tron.module';
import { ZanoModule } from './zano/zano.module';

@Module({
  providers: [EvmDecimalsService, CryptoService, BlockchainRegistryService, TxValidationService],
  imports: [
    SharedModule,
    BitcoinModule,
    BitcoinTestnet4Module,
    LightningModule,
    SparkModule,
    FiroModule,
    MoneroModule,
    ZanoModule,
    BscModule,
    EthereumModule,
    SepoliaModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    FrankencoinModule,
    DEuroModule,
    JuiceModule,
    Ebel2xModule,
    ArweaveModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CardanoModule,
    CitreaModule,
    CitreaTestnetModule,
    ClementineModule,
    BoltzModule,
    RealUnitBlockchainModule,
    Eip7702DelegationModule,
    PimlicoPaymasterModule,
    BlockchainApiModule,
  ],
  exports: [
    BitcoinModule,
    BitcoinTestnet4Module,
    LightningModule,
    SparkModule,
    FiroModule,
    MoneroModule,
    ZanoModule,
    BscModule,
    EthereumModule,
    SepoliaModule,
    OptimismModule,
    ArbitrumModule,
    PolygonModule,
    BaseModule,
    GnosisModule,
    FrankencoinModule,
    DEuroModule,
    JuiceModule,
    Ebel2xModule,
    RailgunModule,
    SolanaModule,
    TronModule,
    CardanoModule,
    CitreaModule,
    CitreaTestnetModule,
    ClementineModule,
    BoltzModule,
    CryptoService,
    BlockchainRegistryService,
    TxValidationService,
    RealUnitBlockchainModule,
    Eip7702DelegationModule,
    PimlicoPaymasterModule,
    BlockchainApiModule,
  ],
})
export class BlockchainModule {}
