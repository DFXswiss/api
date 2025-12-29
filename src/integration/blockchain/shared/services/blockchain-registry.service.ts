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

type BlockchainClientType = EvmClient | BitcoinClient | MoneroClient | ZanoClient | SolanaClient | TronClient | CardanoClient;
type BlockchainServiceType = EvmService | BitcoinService | MoneroService | ZanoService | SolanaService | TronService | CardanoService;

@Injectable()
export class BlockchainRegistryService {
  private readonly serviceMap: Map<Blockchain, BlockchainServiceType>;
  private readonly l2ClientMap: Map<Blockchain, () => EvmClient & L2BridgeEvmClient>;

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
  ) {
    this.serviceMap = new Map([
      [Blockchain.ETHEREUM, this.ethereumService],
      [Blockchain.SEPOLIA, this.sepoliaService],
      [Blockchain.BINANCE_SMART_CHAIN, this.bscService],
      [Blockchain.ARBITRUM, this.arbitrumService],
      [Blockchain.OPTIMISM, this.optimismService],
      [Blockchain.POLYGON, this.polygonService],
      [Blockchain.BASE, this.baseService],
      [Blockchain.GNOSIS, this.gnosisService],
      [Blockchain.BITCOIN, this.bitcoinService],
      [Blockchain.MONERO, this.moneroService],
      [Blockchain.ZANO, this.zanoService],
      [Blockchain.SOLANA, this.solanaService],
      [Blockchain.TRON, this.tronService],
      [Blockchain.CARDANO, this.cardanoService],
      [Blockchain.CITREA_TESTNET, this.citreaTestnetService],
    ]);

    this.l2ClientMap = new Map([
      [Blockchain.ARBITRUM, () => this.arbitrumService.getDefaultClient()],
      [Blockchain.OPTIMISM, () => this.optimismService.getDefaultClient()],
      [Blockchain.POLYGON, () => this.polygonService.getDefaultClient()],
      [Blockchain.BASE, () => this.baseService.getDefaultClient()],
      [Blockchain.GNOSIS, () => this.gnosisService.getDefaultClient()],
    ]);
  }

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
    const service = this.serviceMap.get(blockchain);
    if (!service) throw new Error(`No service found for blockchain ${blockchain}`);
    return service;
  }

  getL2Client(blockchain: Blockchain): EvmClient & L2BridgeEvmClient {
    const clientFactory = this.l2ClientMap.get(blockchain);
    if (!clientFactory) throw new Error(`No l2 client found for blockchain ${blockchain}`);
    return clientFactory();
  }
}
