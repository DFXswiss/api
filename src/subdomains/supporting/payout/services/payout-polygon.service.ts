import { Injectable } from '@nestjs/common';
import { PolygonClient } from 'src/integration/blockchain/polygon/polygon-client';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutPolygonService extends PayoutEvmService {
  private readonly polygonClient: PolygonClient;

  constructor(polygonService: PolygonService) {
    super(polygonService);
    this.polygonClient = polygonService.getDefaultClient<PolygonClient>();
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.polygonClient.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.polygonClient.getCurrentGasCostForTokenTransaction(token);
  }
}
