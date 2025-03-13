import { Injectable } from '@nestjs/common';
import { ArbitrumClient } from 'src/integration/blockchain/arbitrum/arbitrum-client';
import { ArbitrumService } from 'src/integration/blockchain/arbitrum/arbitrum.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutArbitrumService extends PayoutEvmService {
  private readonly arbitrumClient: ArbitrumClient;

  constructor(arbitrumService: ArbitrumService) {
    super(arbitrumService);
    this.arbitrumClient = arbitrumService.getDefaultClient<ArbitrumClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.arbitrumClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.arbitrumClient.getCurrentGasCostForTokenTransaction(token);
  }
}
