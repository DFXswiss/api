import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGnosisService } from '../../../services/payout-gnosis.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class GnosisTokenStrategy extends EvmStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    protected readonly gnosisService: PayoutGnosisService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(gnosisService, payoutOrderRepo);

    this.logger = this.loggerFactory.create(GnosisTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.gnosisService.sendToken(order.destinationAddress, order.asset, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(token: Asset): Promise<number> {
    return this.gnosisService.getCurrentGasForTokenTransaction(token);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getGnosisCoin();
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.gnosisService.getPayoutCompletionData(payoutTxId);
  }
}
