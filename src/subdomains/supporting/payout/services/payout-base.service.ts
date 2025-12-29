import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BaseClient } from 'src/integration/blockchain/base/base-client';
import { BaseService } from 'src/integration/blockchain/base/base.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutBaseService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.BASE;
  private readonly baseClient: BaseClient;

  constructor(factory: PayoutEvmFactory, baseService: BaseService) {
    super(factory);
    this.baseClient = baseService.getDefaultClient<BaseClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.baseClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.baseClient.getCurrentGasCostForTokenTransaction(token);
  }
}
