import { Injectable } from '@nestjs/common';
import { BaseClient } from 'src/integration/blockchain/base/base-client';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutBaseService extends PayoutEvmService {
  protected client: BaseClient;

  constructor(baseService: BaseService) {
    super(baseService);
    this.client = baseService.getDefaultClient<BaseClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }
}
