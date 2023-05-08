import { Injectable } from '@nestjs/common';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityBalanceIntegration } from '../../interfaces';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { Util } from 'src/shared/utils/util';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private readonly refreshInterval = 45; // seconds

  private readonly balanceCache = new Map<number, number>();
  private readonly updateCalls = new Map<Blockchain, Promise<void>>();
  private readonly updateTimestamps = new Map<Blockchain, Date>();

  private dexClient: DeFiClient;
  private btcClient: BtcClient;

  constructor(
    private readonly dexService: DexService,
    private readonly evmRegistryService: EvmRegistryService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.btcClient = client));
  }

  async getBalances(assets: Asset[]): Promise<LiquidityBalance[]> {
    if (!assets.every((a) => a instanceof Asset)) {
      throw new Error(`BlockchainAdapter supports only assets`);
    }

    assets = await Util.asyncFilter(assets, (a) => this.hasSafeBalance(a));

    const blockchainAssets = Util.groupBy<Asset, Blockchain>(assets, 'blockchain');

    const balances = await Util.doGetFulfilled(
      Array.from(blockchainAssets.entries()).map(([b, a]) => this.getForBlockchain(b, a)),
    );

    return balances.reduce((prev, curr) => prev.concat(curr), []);
  }

  private async getForBlockchain(blockchain: Blockchain, assets: Asset[]): Promise<LiquidityBalance[]> {
    const hasCache =
      assets.every((a) => this.balanceCache.has(a.id)) &&
      this.updateTimestamps.get(blockchain) > Util.secondsBefore(this.refreshInterval);

    if (!hasCache) {
      await this.updateCacheFor(blockchain, assets);
    }

    return assets
      .filter((a) => this.balanceCache.has(a.id))
      .map((a) => LiquidityBalance.create(a, this.balanceCache.get(a.id)));
  }

  // --- BALANCE UPDATES --- //

  private async updateCacheFor(blockchain: Blockchain, assets: Asset[]): Promise<void> {
    if (!this.updateCalls.get(blockchain)) {
      this.updateCalls.set(blockchain, this.updateBalancesFor(blockchain, assets));
    }

    return this.updateCalls.get(blockchain);
  }

  private async updateBalancesFor(blockchain: Blockchain, assets: Asset[]): Promise<void> {
    const updated = new Date();

    try {
      switch (blockchain) {
        case Blockchain.DEFICHAIN:
          await this.getForDeFiChain(assets);
          break;
        case Blockchain.BITCOIN:
          await this.getForBitcoin(assets);
          break;
        case Blockchain.ETHEREUM:
        case Blockchain.BINANCE_SMART_CHAIN:
        case Blockchain.OPTIMISM:
        case Blockchain.ARBITRUM:
          await this.getForEvm(assets);
          break;
        default:
          throw new Error(`${blockchain} is not supported by BlockchainAdapter`);
      }

      this.updateTimestamps.set(blockchain, updated);
    } finally {
      this.updateCalls.delete(blockchain);
    }
  }

  // --- BLOCKCHAIN INTEGRATIONS --- //
  private async getForDeFiChain(assets: Asset[]): Promise<void> {
    try {
      // fetch amounts
      const coinAmount = await this.dexClient.getBalance();
      const tokenAmounts = await this.dexClient
        .getToken()
        .then((tokens) => tokens.map((t) => this.dexClient.parseAmount(t.amount)));

      // update cache
      for (const asset of assets) {
        const balance =
          asset.type === AssetType.COIN
            ? +coinAmount
            : tokenAmounts.find((t) => t.asset === asset.dexName)?.amount ?? 0;
        this.balanceCache.set(asset.id, balance);
      }
    } catch (e) {
      console.error(`Failed to update liquidity management balance for ${Blockchain.DEFICHAIN}:`, e);
      this.invalidateCacheFor(assets);
    }
  }

  private async getForBitcoin(assets: Asset[]): Promise<void> {
    for (const asset of assets) {
      try {
        if (asset.type !== AssetType.COIN) throw new Error(`Only coins are available on ${Blockchain.BITCOIN}`);

        const balance = await this.btcClient.getBalance();
        this.balanceCache.set(asset.id, +balance);
      } catch (e) {
        console.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  private async getForEvm(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;

    const blockchain = assets[0].blockchain;
    const client = this.evmRegistryService.getClient(blockchain);

    const tokenTransactions = await client.getERC20Transactions(client.dfxAddress, 0);
    const recentTransactions = tokenTransactions.filter(
      (tx) => new Date(+tx.timeStamp * 1000) > this.updateTimestamps.get(blockchain),
    );

    // update all assets with missing cache or with recent transactions
    const assetsToUpdate = assets.filter(
      (a) =>
        a.type === AssetType.COIN || !this.balanceCache.has(a.id) || recentTransactions.some((tx) => tx.tokenSymbol),
    );

    for (const asset of assetsToUpdate) {
      try {
        const balance =
          asset.type === AssetType.COIN ? await client.getNativeCoinBalance() : await client.getTokenBalance(asset);

        this.balanceCache.set(asset.id, balance);
      } catch (e) {
        console.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  // --- HELPER METHODS --- //
  private invalidateCacheFor(assets: Asset[]) {
    assets.forEach((a) => this.balanceCache.delete(a.id));
  }

  private async hasSafeBalance(asset: Asset): Promise<boolean> {
    const ongoingOrders = await this.dexService.getPendingOrdersCount(asset);

    if (ongoingOrders) {
      console.warn(`Cannot safely get balance of ${asset.uniqueName} (${ongoingOrders} DEX order(s) ongoing)`);
    }

    return ongoingOrders === 0;
  }
}
