import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscCoinStrategy extends EvmStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    protected readonly bscService: PayoutBscService,
    protected readonly assetService: AssetService,
    payoutOrderRepo: PayoutOrderRepository,
  ) {
    super(bscService, payoutOrderRepo);

    this.logger = this.loggerFactory.create(BscCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    const nonce = await this.getOrderNonce(order);

    return this.bscService.sendNativeCoin(order.destinationAddress, order.amount, nonce);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return this.bscService.getCurrentGasForCoinTransaction();
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBnbCoin();
  }
}
