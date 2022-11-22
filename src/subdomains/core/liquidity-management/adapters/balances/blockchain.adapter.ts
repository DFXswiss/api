import { v4 as uuid } from 'uuid';
import { Injectable } from '@nestjs/common';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityBalanceIntegration } from '../../interfaces';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { Util } from 'src/shared/utils/util';
import { BalanceNotCertainException } from '../../exceptions/balance-not-certain.exception';

type AssetHash = string;
interface Balance {
  name: string;
  type: AssetType;
  amount: number;
}

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private dexClient: DeFiClient;

  private defiChainCache: Map<AssetHash, number> = new Map();
  private defiChainCacheTimestamp = 0;
  private defiChainCacheUpdateCall: Promise<Map<AssetHash, number>> | null = null;

  constructor(private readonly dexService: DexService, readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async getBalance(asset: Asset): Promise<LiquidityBalance> {
    if (!(asset instanceof Asset)) {
      throw new Error(`BlockchainAdapter supports only Assets.`);
    }

    await this.checkOngoingOrders(asset);

    if (
      asset.blockchain === Blockchain.ETHEREUM ||
      asset.blockchain === Blockchain.BINANCE_SMART_CHAIN ||
      asset.blockchain === Blockchain.BITCOIN
    ) {
      return LiquidityBalance.create(asset, await this.getForNonDeFiChain(asset));
    }

    if (asset.blockchain === Blockchain.DEFICHAIN) {
      return LiquidityBalance.create(asset, await this.getForDeFiChain(asset));
    }

    throw new Error(
      `Error when getting balance for liquidity management. Provided blockchain is not supported by BlockchainAdapter: ${asset.blockchain}`,
    );
  }

  //*** HELPER METHODS ***//

  private async checkOngoingOrders(asset: Asset): Promise<void> {
    const ongoingOrders = await this.dexService.getPendingOrdersCount(asset);

    if (ongoingOrders) {
      const { dexName, type, blockchain } = asset;
      throw new BalanceNotCertainException(
        `Cannot safely get balance of ${blockchain} ${dexName} ${type}. There is/are ${ongoingOrders} ongoing DEX order(s).`,
      );
    }
  }

  private async getForNonDeFiChain(asset: Asset): Promise<number> {
    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: uuid(),
      referenceAsset: asset,
      referenceAmount: 1,
      targetAsset: asset,
    };

    const liquidity = await this.dexService.checkLiquidity(request);

    return liquidity.target.availableAmount;
  }

  private async getForDeFiChain(asset: Asset): Promise<number> {
    if (!this.defiChainCacheUpdateCall && Util.secondsDiff(new Date(this.defiChainCacheTimestamp), new Date()) > 30) {
      return this.updateCache().then(() => this.getFromCache(asset));
    }

    if (!this.defiChainCacheUpdateCall && Util.secondsDiff(new Date(this.defiChainCacheTimestamp), new Date()) <= 30) {
      return this.getFromCache(asset);
    }

    return this.defiChainCacheUpdateCall.then(() => this.getFromCache(asset));
  }

  private async updateCache(): Promise<Map<AssetHash, number>> {
    if (this.defiChainCacheUpdateCall) return this.defiChainCacheUpdateCall;

    /**
     * @note
     * Should assign promise, not the result of the promise
     */
    this.defiChainCacheUpdateCall = this.getNewBalances();

    return this.defiChainCacheUpdateCall;
  }

  private async getNewBalances(): Promise<Map<AssetHash, number>> {
    const tokens = await this.dexClient.getToken();
    const coinAmount = await this.dexClient.getBalance();

    const tokensResult = this.aggregateBalances(tokens, +coinAmount);

    this.setCache(tokensResult);
    this.resetCacheUpdateCall();

    return this.defiChainCache;
  }

  private getFromCache(asset: Asset): number {
    const { dexName: name, type } = asset;

    return this.defiChainCache.get(`${name}_${type}`);
  }

  private aggregateBalances(tokens: AccountResult<string, string>[], coinAmount: number): Balance[] {
    const allBalances = tokens
      .map((t) => {
        const { asset, amount } = this.dexClient.parseAmount(t.amount);

        return { key: `${asset}_${AssetType.TOKEN}`, amount };
      })
      .concat([{ key: `DFI_${AssetType.COIN}`, amount: +coinAmount }]);

    // TODO -> filter by address DEX_WALLET_ADDRESS instead of summing up
    const aggregatedBalances = Util.aggregate<{ key: string; amount: number }>(allBalances, 'key', 'amount');

    return Object.entries(aggregatedBalances).map((e) => ({
      name: e[0].split('_')[0],
      type: e[0].split('_')[1] as AssetType,
      amount: e[1],
    }));
  }

  private setCache(balances: Balance[]): void {
    for (const balance of balances) {
      const { name, type, amount } = balance;

      this.defiChainCache.set(`${name}_${type}`, amount);
    }
  }

  private resetCacheUpdateCall(): void {
    this.defiChainCacheUpdateCall = null;
  }
}
