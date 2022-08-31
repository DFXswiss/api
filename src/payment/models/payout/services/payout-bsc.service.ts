import { Injectable } from '@nestjs/common';
import { BSCClient } from 'src/blockchain/bsc/bsc-client';
import { BSCService } from 'src/blockchain/bsc/bsc.service';

@Injectable()
export class PayoutBSCService {
  #bscClient: BSCClient;

  constructor(bscService: BSCService) {
    this.#bscClient = bscService.getClient();
  }

  async send(address: string, amount: number): Promise<string> {
    return this.#bscClient.send(address, amount);
  }

  async checkPayoutCompletion(txHash: string): Promise<boolean> {
    return this.#bscClient.isTxComplete(txHash);
  }
}
