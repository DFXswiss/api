import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutFiroService } from '../../../services/payout-firo.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class FiroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(FiroStrategy);

  constructor(
    notificationService: NotificationService,
    protected readonly firoService: PayoutFiroService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, firoService);
  }

  get blockchain(): Blockchain {
    return Blockchain.FIRO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(_targetAsset: Asset, address?: string): Promise<FeeResult> {
    const feeRate = await this.firoService.getCurrentFeeRate();
    const { transparentTxSize, sparkMintTxSize } = Config.blockchain.firo;
    const txSize = address && CryptoService.isFiroSparkAddress(address) ? sparkMintTxSize : transparentTxSize;
    const firoFeeAmount = Util.round((txSize * feeRate) / 1e8, 8);

    return { asset: await this.feeAsset(), amount: firoFeeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const sparkOrders: PayoutOrder[] = [];
    const transparentOrders: PayoutOrder[] = [];
    for (const o of orders) {
      (CryptoService.isFiroSparkAddress(o.destinationAddress) ? sparkOrders : transparentOrders).push(o);
    }

    if (sparkOrders.length > 0) {
      await this.payoutOrderGroup(context, sparkOrders, 'Spark');
    }

    if (transparentOrders.length > 0) {
      await this.payoutOrderGroup(context, transparentOrders, 'transparent');
    }
  }

  private async payoutOrderGroup(context: PayoutOrderContext, orders: PayoutOrder[], type: string): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(
          `Paying out ${group.length} FIRO ${type} orders(s). Order ID(s): ${group.map((o) => o.id)}`,
        );

        await this.sendFIRO(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} FIRO ${type} orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const isSpark = payout.length > 0 && CryptoService.isFiroSparkAddress(payout[0].addressTo);

    if (isSpark) {
      const allSpark = payout.every((p) => CryptoService.isFiroSparkAddress(p.addressTo));
      if (!allSpark) throw new Error('Mixed Spark/transparent payout group detected');
      return this.firoService.mintSpark(payout);
    }

    return this.firoService.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getFiroCoin();
  }

  private async sendFIRO(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }
}
