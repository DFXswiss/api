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
    if (!this.defiChainCacheUpdateCall && Date.now() - this.defiChainCacheTimestamp > 30000) {
      return this.updateCache().then(() => this.getFromCache(asset));
    }

    if (!this.defiChainCacheUpdateCall && Date.now() - this.defiChainCacheTimestamp <= 30000) {
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

    return this.defiChainCache.get(JSON.stringify({ name, type }));
  }

  private aggregateBalances(tokens: AccountResult<string, string>[], coinAmount: number): Balance[] {
    return tokens
      .map((t) => {
        const { asset, amount } = this.dexClient.parseAmount(t.amount);

        return { name: asset, type: AssetType.TOKEN, amount };
      })
      .concat([{ name: 'DFI', type: AssetType.COIN, amount: +coinAmount }]);
  }

  private setCache(balances: Balance[]): void {
    for (const balance of balances) {
      const { name, type, amount } = balance;

      this.defiChainCache.set(JSON.stringify({ name, type }), amount);
    }
  }

  private resetCacheUpdateCall(): void {
    this.defiChainCacheUpdateCall = null;
  }
}
