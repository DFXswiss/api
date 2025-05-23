import { Injectable } from '@nestjs/common';
import { ArbitrumService } from '../../arbitrum/arbitrum.service';
import { BaseService } from '../../base/base.service';
import { BitcoinClient } from '../../bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from '../../bitcoin/node/bitcoin.service';
import { BscService } from '../../bsc/bsc.service';
import { EthereumService } from '../../ethereum/ethereum.service';
import { MoneroClient } from '../../monero/monero-client';
import { MoneroService } from '../../monero/services/monero.service';
import { OptimismService } from '../../optimism/optimism.service';
import { PolygonService } from '../../polygon/polygon.service';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmClient } from '../evm/evm-client';
import { EvmService } from '../evm/evm.service';
import { L2BridgeEvmClient } from '../evm/interfaces';

@Injectable()
export class BlockchainRegistryService {
  constructor(
    private readonly ethereumService: EthereumService,
    private readonly bscService: BscService,
    private readonly arbitrumService: ArbitrumService,
    private readonly optimismService: OptimismService,
    private readonly polygonService: PolygonService,
    private readonly baseService: BaseService,
    private readonly moneroService: MoneroService,
    private readonly bitcoinService: BitcoinService,
  ) {}

  getClient(blockchain: Blockchain): EvmClient | MoneroClient | BitcoinClient {
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

  getService(blockchain: Blockchain): EvmService | MoneroService | BitcoinService {
    switch (blockchain) {
      case Blockchain.ETHEREUM:
        return this.ethereumService;
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
      case Blockchain.MONERO:
        return this.moneroService;
      case Blockchain.BITCOIN:
        return this.bitcoinService;

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

      default:
        throw new Error(`No l2 client found for blockchain ${blockchain}`);
    }
  }
}
