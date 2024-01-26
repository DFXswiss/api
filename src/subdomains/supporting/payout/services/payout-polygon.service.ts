import { Injectable } from '@nestjs/common';
import { PolygonClient } from 'src/integration/blockchain/polygon/polygon-client';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutPolygonService extends PayoutEvmService {
  protected client: PolygonClient;

  constructor(polygonService: PolygonService) {
    super(polygonService);
    this.client = polygonService.getDefaultClient<PolygonClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }
}
