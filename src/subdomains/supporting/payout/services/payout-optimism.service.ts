import { Injectable } from '@nestjs/common';
import { OptimismClient } from 'src/integration/blockchain/optimism/optimism-client';
import { OptimismService } from 'src/integration/blockchain/optimism/optimism.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutOptimismService extends PayoutEvmService {
  private readonly optimismClient: OptimismClient;

  constructor(optimismService: OptimismService) {
    super(optimismService);
    this.optimismClient = optimismService.getDefaultClient<OptimismClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.optimismClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.optimismClient.getCurrentGasCostForTokenTransaction(token);
  }
}
