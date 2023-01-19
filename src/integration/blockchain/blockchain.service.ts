import { Injectable } from '@nestjs/common';
import { ArbitrumService } from './arbitrum/arbitrum.service';
import { BscService } from './bsc/bsc.service';
import { EthereumService } from './ethereum/ethereum.service';
import { OptimismService } from './optimism/optimism.service';
import { Blockchain } from './shared/enums/blockchain.enum';
import { EvmService } from './shared/evm/evm.service';

@Injectable()
export class BlockchainService {
  private readonly evmServices = new Map<Blockchain, EvmService>();

  constructor(
    arbitrumService: ArbitrumService,
    bscService: BscService,
    ethereumService: EthereumService,
    optimismService: OptimismService,
  ) {
    this.evmServices.set(Blockchain.ARBITRUM, arbitrumService);
    this.evmServices.set(Blockchain.BINANCE_SMART_CHAIN, bscService);
    this.evmServices.set(Blockchain.ETHEREUM, ethereumService);
    this.evmServices.set(Blockchain.OPTIMISM, optimismService);
  }

  getRandomEvmWallet(blockchain: Blockchain): { address: string; privateKey: string } {
    const service = this.evmServices.get(blockchain);

    if (!service) throw new Error(`No EVM service found for blockchain ${blockchain}`);

    const { address, privateKey } = service.getDefaultClient().getRandomWallet();

    return { address, privateKey };
  }
}
