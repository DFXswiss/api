import { Injectable } from '@nestjs/common';
import { ArbitrumService } from '../../arbitrum/arbitrum.service';
import { BaseService } from '../../base/base.service';
import { BitcoinClient } from '../../bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from '../../bitcoin/node/bitcoin.service';
import { BscService } from '../../bsc/bsc.service';
import { EthereumService } from '../../ethereum/ethereum.service';
import { SepoliaService } from '../../sepolia/sepolia.service';
import { GnosisService } from '../../gnosis/gnosis.service';
import { MoneroClient } from '../../monero/monero-client';
import { MoneroService } from '../../monero/services/monero.service';
import { OptimismService } from '../../optimism/optimism.service';
import { PolygonService } from '../../polygon/polygon.service';
import { SolanaService } from '../../solana/services/solana.service';
import { SolanaClient } from '../../solana/solana-client';
import { TronService } from '../../tron/services/tron.service';
import { TronClient } from '../../tron/tron-client';
import { CardanoService } from '../../cardano/services/cardano.service';
import { CardanoClient } from '../../cardano/cardano-client';
import { CitreaTestnetService } from '../../citrea-testnet/citrea-testnet.service';
import { ZanoService } from '../../zano/services/zano.service';
import { ZanoClient } from '../../zano/zano-client';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmClient } from '../evm/evm-client';
import { EvmService } from '../evm/evm.service';
import { L2BridgeEvmClient } from '../evm/interfaces';

type BlockchainClientType =
  | EvmClient
  | BitcoinClient
  | MoneroClient
  | ZanoClient
  | SolanaClient
  | TronClient
  | CardanoClient;
type BlockchainServiceType =
  | EvmService
  | BitcoinService
  | MoneroService
  | ZanoService
  | SolanaService
  | TronService
  | CardanoService;

@Injectable()
export class BlockchainRegistryService {
  constructor(
    private readonly ethereumService: EthereumService,
    private readonly sepoliaService: SepoliaService,
    private readonly bscService: BscService,
    private readonly arbitrumService: ArbitrumService,
    private readonly optimismService: OptimismService,
    private readonly polygonService: PolygonService,
    private readonly baseService: BaseService,
    private readonly gnosisService: GnosisService,
    private readonly bitcoinService: BitcoinService,
    private readonly moneroService: MoneroService,
    private readonly zanoService: ZanoService,
    private readonly solanaService: SolanaService,
    private readonly tronService: TronService,
    private readonly cardanoService: CardanoService,
    private readonly citreaTestnetService: CitreaTestnetService,
  ) {}

  getClient(blockchain: Blockchain): BlockchainClientType {
    return this.getService(blockchain).getDefaultClient();
  }

  getEvmClient(blockchain: Blockchain): EvmClient {
    const blockchainService = this.getService(blockchain);
    if (!(blockchainService instanceof EvmService)) throw new Error(`No evm client found for blockchain ${blockchain}`);
    return blockchainService.getDefaultClient();
  }

  getBitcoinClient(blockchain: Blockchain, type: BitcoinNodeType): BitcoinClient {
    const blockchainService = this.getService(blockchain);
    if (!(blockchainService instanceof BitcoinService))
      throw new Error(`No bitcoin client found for blockchain ${blockchain}`);
    return blockchainService.getDefaultClient(type);
  }

  getService(blockchain: Blockchain): BlockchainServiceType {
    switch (blockchain) {
      case Blockchain.ETHEREUM:
        return this.ethereumService;
      case Blockchain.SEPOLIA:
        return this.sepoliaService;
      case Blockchain.BINANCE_SMART_CHAIN:
        return this.bscService;
      case Blockchain.ARBITRUM:
        return this.arbitrumService;
      case Blockchain.OPTIMISM:
        return this.optimismService;
      case Blockchain.POLYGON:
        return this.polygonService;
      case Blockchain.BASE:
        return this.baseService;
      case Blockchain.GNOSIS:
        return this.gnosisService;
      case Blockchain.BITCOIN:
        return this.bitcoinService;
      case Blockchain.MONERO:
        return this.moneroService;
      case Blockchain.ZANO:
        return this.zanoService;
      case Blockchain.SOLANA:
        return this.solanaService;
      case Blockchain.TRON:
        return this.tronService;
      case Blockchain.CARDANO:
        return this.cardanoService;
      case Blockchain.CITREA_TESTNET:
        return this.citreaTestnetService;

      default:
        throw new Error(`No service found for blockchain ${blockchain}`);
    }
  }

  getL2Client(blockchain: Blockchain): EvmClient & L2BridgeEvmClient {
    switch (blockchain) {
      case Blockchain.ARBITRUM:
        return this.arbitrumService.getDefaultClient();
      case Blockchain.OPTIMISM:
        return this.optimismService.getDefaultClient();
      case Blockchain.POLYGON:
        return this.polygonService.getDefaultClient();
      case Blockchain.BASE:
        return this.baseService.getDefaultClient();
      case Blockchain.GNOSIS:
        return this.gnosisService.getDefaultClient();

      default:
        throw new Error(`No l2 client found for blockchain ${blockchain}`);
    }
  }
}
