import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutBitcoinTestnet4Service } from '../../../services/payout-bitcoin-testnet4.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class BitcoinTestnet4Strategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(BitcoinTestnet4Strategy);

  private readonly averageTransactionSize = 140; // vBytes

  constructor(
    notificationService: NotificationService,
    protected readonly bitcoinTestnet4Service: PayoutBitcoinTestnet4Service,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, bitcoinTestnet4Service);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN_TESTNET4;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(): Promise<FeeResult> {
    const feeRate = await this.bitcoinTestnet4Service.getCurrentFeeRate();
    const satoshiFeeAmount = this.averageTransactionSize * feeRate;
    const btcFeeAmount = Util.round(satoshiFeeAmount / 100000000, 8);

    return { asset: await this.feeAsset(), amount: btcFeeAmount };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const payoutGroups = this.createPayoutGroups(orders, 100);

    for (const group of payoutGroups) {
      try {
        if (group.length === 0) {
          continue;
        }

        this.logger.verbose(
          `Paying out ${group.length} BTC Testnet4 orders(s). Order ID(s): ${group.map((o) => o.id)}`,
        );

        await this.sendBTC(context, group);
      } catch (e) {
        this.logger.error(
          `Error in paying out a group of ${group.length} BTC Testnet4 orders(s). Order ID(s): ${group.map((o) => o.id)}`,
          e,
        );
        continue;
      }
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.bitcoinTestnet4Service.sendUtxoToMany(context, payout);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBitcoinTestnet4Coin();
  }

  private async sendBTC(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }
}
