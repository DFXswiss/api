import { Injectable } from '@nestjs/common';
import { GnosisClient } from 'src/integration/blockchain/gnosis/gnosis-client';
import { GnosisService } from 'src/integration/blockchain/gnosis/gnosis.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutGnosisService extends PayoutEvmService {
  private readonly gnosisClient: GnosisClient;

  constructor(gnosisService: GnosisService) {
    super(gnosisService);
    this.gnosisClient = gnosisService.getDefaultClient<GnosisClient>();
  }

  async getCurrentGasForCoinTransaction(amount: number): Promise<number> {
    return this.gnosisClient.getCurrentGasCostForCoinTransaction(amount);
  }

  async getCurrentGasForTokenTransaction(token: Asset, amount: number): Promise<number> {
    return this.gnosisClient.getCurrentGasCostForTokenTransaction(token, amount);
  }
}
