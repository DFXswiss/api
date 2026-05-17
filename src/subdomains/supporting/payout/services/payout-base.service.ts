import { Injectable } from '@nestjs/common';
import { BaseClient } from 'src/integration/blockchain/base/base-client';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutBaseService extends PayoutEvmService {
  private readonly baseClient: BaseClient;

  constructor(baseService: BaseService) {
    super(baseService);
    this.baseClient = baseService.getDefaultClient<BaseClient>();
  }

  async getCurrentGasCostForCoinTransaction(amount: number): Promise<number> {
    return this.baseClient.getCurrentGasCostForCoinTransaction(amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, amount: number): Promise<number> {
    return this.baseClient.getCurrentGasCostForTokenTransaction(token, amount);
  }
}
