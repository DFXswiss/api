import { Injectable } from '@nestjs/common';
import { ArbitrumClient } from 'src/integration/blockchain/arbitrum/arbitrum-client';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutArbitrumService extends PayoutEvmService {
  protected client: ArbitrumClient;

  constructor(arbitrumService: ArbitrumService) {
    super(arbitrumService);
    this.client = arbitrumService.getDefaultClient<ArbitrumClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasForTokenTransaction(token);
  }
}
