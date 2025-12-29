import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GnosisClient } from 'src/integration/blockchain/gnosis/gnosis-client';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmProxyService } from './base/payout-evm-proxy.service';
import { PayoutEvmFactory } from './payout-evm.factory';

@Injectable()
export class PayoutGnosisService extends PayoutEvmProxyService {
  protected readonly blockchain = Blockchain.GNOSIS;
  private readonly gnosisClient: GnosisClient;

  constructor(factory: PayoutEvmFactory, gnosisService: GnosisService) {
    super(factory);
    this.gnosisClient = gnosisService.getDefaultClient<GnosisClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.gnosisClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.gnosisClient.getCurrentGasCostForTokenTransaction(token);
  }
}
