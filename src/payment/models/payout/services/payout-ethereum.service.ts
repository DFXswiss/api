import { Injectable } from '@nestjs/common';
import { EthereumClient } from 'src/blockchain/eth/ethereum-client';
import { EthereumService } from 'src/blockchain/eth/ethereum.service';

@Injectable()
export class PayoutEthereumService {
  #ethereumClient: EthereumClient;

  constructor(readonly ethereumService: EthereumService) {
    this.#ethereumClient = ethereumService.getClient();
  }

  async send(address: string, amount: number): Promise<string> {
    return this.#ethereumClient.send(address, amount);
  }

  async checkPayoutCompletion(txHash: string): Promise<boolean> {
    return this.#ethereumClient.isTxComplete(txHash);
  }
}
