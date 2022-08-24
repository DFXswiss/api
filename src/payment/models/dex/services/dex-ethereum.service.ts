import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/blockchain/eth/ethereum-client';
import { EthereumService } from 'src/blockchain/eth/ethereum.service';

@Injectable()
export class DexEthereumService {
  #ethereumClient: EthereumClient;

  constructor(ethereumService: EthereumService) {
    this.#ethereumClient = ethereumService.getClient();
  }

  async getBalance(): Promise<number> {
    return this.#ethereumClient.getBalance();
  }
}
