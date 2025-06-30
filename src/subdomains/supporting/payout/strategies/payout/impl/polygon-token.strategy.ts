import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutPolygonService } from '../../../services/payout-polygon.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class PolygonTokenStrategy extends EvmStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    protected readonly polygonService: PayoutPolygonService,
    protected readonly assetService: AssetService,
    readonly loggerFactory: LoggerFactory,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(polygonService, payoutOrderRepo);

    this.logger = this.loggerFactory.create(PolygonTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.polygonService.sendToken(order.destinationAddress, order.asset, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.polygonService.getCurrentGasForTokenTransaction(token);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getPolygonCoin();
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.polygonService.getPayoutCompletionData(payoutTxId);
  }
}
