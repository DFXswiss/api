import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { OptimismClient } from 'src/integration/blockchain/optimism/optimism-client';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutOptimismService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.OPTIMISM;
  private readonly optimismClient: OptimismClient;

  constructor(factory: PayoutEvmFactory, optimismService: OptimismService) {
    super(factory);
    this.optimismClient = optimismService.getDefaultClient<OptimismClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.optimismClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.optimismClient.getCurrentGasCostForTokenTransaction(token);
  }
}
