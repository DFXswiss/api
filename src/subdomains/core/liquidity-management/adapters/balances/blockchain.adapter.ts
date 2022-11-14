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

type AssetHash = string;

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private dexClient: DeFiClient;

  private defiChainCache: Map<AssetHash, number> = new Map();
  private defiChainCacheTimestamp = 0;
  private defiChainCacheUpdate: Promise<Map<AssetHash, number>> | null = null;

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

    throw new Error('');
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
    if (!this.defiChainCacheUpdate && Date.now() - this.defiChainCacheTimestamp > 30000) {
      return this.updateCache().then(() => this.getFromCache(asset));
    }

    if (!this.defiChainCacheUpdate && Date.now() - this.defiChainCacheTimestamp <= 30000) {
      return this.getFromCache(asset);
    }

    return this.defiChainCacheUpdate.then(() => this.getFromCache(asset));
  }

  private async updateCache(): Promise<Map<AssetHash, number>> {
    if (this.defiChainCacheUpdate) return this.defiChainCacheUpdate;

    this.defiChainCacheUpdate = this.getNewBalances();

    return this.defiChainCacheUpdate;
  }

  private async getNewBalances(): Promise<Map<AssetHash, number>> {
    const tokens = await this.dexClient.getToken();
    const coinAmount = await this.dexClient.getBalance();

    const tokensResult = tokens
      .map((t) => {
        const { asset, amount } = this.dexClient.parseAmount(t.amount);

        return { name: asset, type: AssetType.TOKEN, amount };
      })
      .concat([{ name: 'DFI', type: AssetType.COIN, amount: +coinAmount }]);

    for (const token of tokensResult) {
      const { name, type, amount } = token;

      this.defiChainCache.set(JSON.stringify({ name, type }), amount);
    }

    this.defiChainCacheUpdate = null;

    return this.defiChainCache;
  }

  private getFromCache(asset: Asset): number {
    const { dexName: name, type } = asset;

    return this.defiChainCache.get(JSON.stringify({ name, type }));
  }
}
