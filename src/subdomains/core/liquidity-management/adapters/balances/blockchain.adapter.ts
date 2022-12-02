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
import { Config } from 'src/config/config';

type AssetHash = string;
interface Balance {
  name: string;
  type: AssetType;
  amount: number;
}

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private dexClient: DeFiClient;

  private defiChainCache: Map<AssetHash, number> | null = null;
  private defiChainCacheTimestamp = 0;
  private defiChainCacheUpdateCall: Promise<void> | null = null;

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
    if (!this.defiChainCacheUpdateCall) {
      return Util.secondsDiff(new Date(this.defiChainCacheTimestamp), new Date()) > 30
        ? this.updateCache().then(() => this.getFromCache(asset))
        : this.getFromCache(asset);
    }

    return this.defiChainCacheUpdateCall.then(() => this.getFromCache(asset));
  }

  private async updateCache(): Promise<void> {
    if (this.defiChainCacheUpdateCall) return this.defiChainCacheUpdateCall;

    /**
     * @note
     * Should assign promise, not the result of the promise
     */
    this.defiChainCacheUpdateCall = this.cacheNewBalances();

    return this.defiChainCacheUpdateCall;
  }

  private async cacheNewBalances(): Promise<void> {
    try {
      const tokens = await this.dexClient.getToken();
      const coinAmount = await this.dexClient.getBalance();

      const tokensResult = this.aggregateBalances(tokens, +coinAmount);

      this.setCache(tokensResult);
    } catch {
      this.invalidateCache();
    } finally {
      this.resetCacheUpdateCall();
    }
  }

  private getFromCache(asset: Asset): number {
    const { dexName: name, type } = asset;

    if (!this.defiChainCache) {
      throw new Error('Cannot get balance, cache was invalidated due to error while getting new balances');
    }

    return this.defiChainCache.get(`${name}_${type}`);
  }

  private aggregateBalances(tokens: AccountResult<string, string>[], coinAmount: number): Balance[] {
    return tokens
      .filter((t) => t.owner === Config.blockchain.default.dexWalletAddress)
      .map((t) => {
        const { asset, amount } = this.dexClient.parseAmount(t.amount);

        return { name: asset, type: AssetType.TOKEN, amount };
      })
      .concat([{ name: 'DFI', type: AssetType.COIN, amount: +coinAmount }]);
  }

  private setCache(balances: Balance[]): void {
    /**
     * @note
     * cleanup cache to remove tokens which balances went to 0
     */
    this.defiChainCache = new Map();

    for (const balance of balances) {
      const { name, type, amount } = balance;

      this.defiChainCache.set(`${name}_${type}`, amount);
    }
  }

  private invalidateCache(): void {
    /**
     * @note
     * invalidating cache means removing it altogether and not being able to access it
     * just cleaning up the cache with `new Map()` could also mean 0 balances for tokens
     */
    this.defiChainCache = null;
  }

  private resetCacheUpdateCall(): void {
    this.defiChainCacheUpdateCall = null;
  }
}
