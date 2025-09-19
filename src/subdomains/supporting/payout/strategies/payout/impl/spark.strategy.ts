import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutSparkService } from '../../../services/payout-spark.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class SparkStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(SparkStrategy);

  constructor(
    notificationService: NotificationService,
    protected readonly sparkService: PayoutSparkService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, sparkService);
  }

  get blockchain(): Blockchain {
    return Blockchain.SPARK;
  }

  get assetType(): AssetType {
    return undefined; // Spark is a native coin, not a token
  }

  async estimateFee(): Promise<FeeResult> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return {
      asset: await this.feeAsset(),
      amount: 0
    };
  }

  protected async doPayoutForContext(
    context: PayoutOrderContext,
    orders: PayoutOrder[]
  ): Promise<void> {
    // Create payout groups with max 100 outputs per transaction
    const batchSize = this.sparkService.getBatchSize();
    const payoutGroups = this.createPayoutGroups(orders, batchSize);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(
          `Paying out ${group.length} SPARK order(s). Order ID(s): ${group.map((o) => o.id)}`
        );

        await this.sendSPARK(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} SPARK order(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        // Continue with next group in case payout failed
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.sparkService.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getSparkCoin();
  }

  private async sendSPARK(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders, 'BTC');
  }
}