import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrder, PayoutOrderContext } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoinbased.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { BitcoinbasedStrategy } from './base/bitcoinbased.strategy';

type TokenName = string;

@Injectable()
export class DeFiChainTokenStrategy extends BitcoinbasedStrategy {
  protected readonly logger = new DfxLogger(DeFiChainTokenStrategy);

  constructor(
    notificationService: NotificationService,
    private readonly dexService: DexService,
    protected readonly bitcoinbasedService: PayoutDeFiChainService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, bitcoinbasedService);
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  async estimateFee(): Promise<FeeResult> {
    return { asset: await this.feeAsset(), amount: 0 };
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    const tokenGroups = this.groupOrdersByTokens(orders);

    for (const [tokenName, tokenGroup] of tokenGroups.entries()) {
      const payoutGroups = this.createPayoutGroups(tokenGroup, 10);

      for (const group of payoutGroups) {
        try {
          if (group.length === 0) {
            continue;
          }

          this.logger.verbose(`Paying out ${group.length} token orders(s). Order ID(s): ${group.map((o) => o.id)}`);

          await this.checkUtxoForGroup(group);
          await this.sendToken(context, group, tokenName);
        } catch (e) {
          this.logger.error(
            `Error in paying out a group of ${group.length} token orders(s). Order ID(s): ${group.map((o) => o.id)}:`,
            e,
          );
          // continue with next group in case payout failed
          continue;
        }
      }
    }
  }

  protected groupOrdersByTokens(orders: PayoutOrder[]): Map<TokenName, PayoutOrder[]> {
    const groups = new Map<TokenName, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.asset.dexName);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.asset.dexName, [order]);
      }
    });

    return groups;
  }

  private async checkUtxoForGroup(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      if (this.isEligibleForMinimalUtxo(order.destinationAddress)) {
        await this.checkUtxo(order.destinationAddress);
      }
    }
  }

  private isEligibleForMinimalUtxo(address: string): boolean {
    return this.bitcoinbasedService.isLightWalletAddress(address);
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.bitcoinbasedService.getUtxoForAddress(address);

    if (!utxo) {
      await this.dexService.transferMinimalCoin(BlockchainAddress.create(address, Blockchain.DEFICHAIN));
    }
  }

  protected dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup, outputAsset: string): Promise<string> {
    return this.bitcoinbasedService.sendTokenToMany(context, payout, outputAsset);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  private async sendToken(context: PayoutOrderContext, orders: PayoutOrder[], outputAsset: string): Promise<void> {
    await this.send(context, orders, outputAsset);
  }
}
