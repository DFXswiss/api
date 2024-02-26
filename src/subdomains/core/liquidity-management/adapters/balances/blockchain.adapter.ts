import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmTokenBalance } from 'src/integration/blockchain/shared/evm/dto/evm-token-balance.dto';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { isAsset } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration } from '../../interfaces';

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(BlockchainAdapter);

  private readonly refreshInterval = 45; // seconds

  private readonly balanceCache = new Map<number, number>();
  private readonly updateCalls = new Map<Blockchain, Promise<void>>();
  private readonly updateTimestamps = new Map<Blockchain, Date>();

  private dexClient: DeFiClient;
  private btcClient: BtcClient;
  private lightningClient: LightningClient;
  private moneroClient: MoneroClient;

  constructor(
    private readonly dexService: DexService,
    private readonly evmRegistryService: EvmRegistryService,
    nodeService: NodeService,
    lightningService: LightningService,
    moneroService: MoneroService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.btcClient = client));
    this.lightningClient = lightningService.getDefaultClient();
    this.moneroClient = moneroService.getDefaultClient();
  }

  async getBalances(assets: (Asset & { context: LiquidityManagementContext })[]): Promise<LiquidityBalance[]> {
    if (!assets.every(isAsset)) {
      throw new Error(`BlockchainAdapter supports only assets`);
    }

    const blockchainAssets = Util.groupBy<Asset, Blockchain>(assets, 'blockchain');

    const balances = await Util.doGetFulfilled(
      Array.from(blockchainAssets.entries()).map(([b, a]) => this.getForBlockchain(b, a)),
    );

    return balances.reduce((prev, curr) => prev.concat(curr), []);
  }

  async getNumberOfPendingOrders(asset: Asset): Promise<number> {
    return this.dexService.getPendingOrdersCount(asset);
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
        case Blockchain.LIGHTNING:
          await this.getForBitcoin(assets);
          break;

        case Blockchain.MONERO:
          await this.getForMonero(assets);
          break;

        case Blockchain.ETHEREUM:
        case Blockchain.OPTIMISM:
        case Blockchain.ARBITRUM:
        case Blockchain.POLYGON:
        case Blockchain.BASE:
          await this.getForEvm(assets);
          break;

        case Blockchain.BINANCE_SMART_CHAIN:
          await this.getForBsc(assets);
          break;

        default:
          throw new Error(`${blockchain} is not supported by BlockchainAdapter`);
      }

      this.updateTimestamps.set(blockchain, updated);
    } catch (e) {
      this.logger.error(`Failed to update balances for ${blockchain}:`, e);
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
      this.logger.error(`Failed to update liquidity management balance for ${Blockchain.DEFICHAIN}:`, e);
      this.invalidateCacheFor(assets);
    }
  }

  private async getForBitcoin(assets: Asset[]): Promise<void> {
    for (const asset of assets) {
      try {
        if (asset.type !== AssetType.COIN) throw new Error(`Only coins are available on ${asset.blockchain}`);

        const client = asset.blockchain === Blockchain.BITCOIN ? this.btcClient : this.lightningClient;

        const balance = await client.getBalance();
        this.balanceCache.set(asset.id, +balance);
      } catch (e) {
        this.logger.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  private async getForMonero(assets: Asset[]): Promise<void> {
    for (const asset of assets) {
      try {
        if (asset.type !== AssetType.COIN) throw new Error(`Only coins are available on ${asset.blockchain}`);

        const balance = await this.moneroClient.getBalance().then((b) => b.balance);
        this.balanceCache.set(asset.id, balance);
      } catch (e) {
        this.logger.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  private async getForEvm(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;

    const blockchain = assets[0].blockchain;
    const client = this.evmRegistryService.getClient(blockchain);

    let coinBalance: number;
    let tokenBalances: EvmTokenBalance[];

    try {
      coinBalance = await client.getNativeCoinBalance();
      tokenBalances = await client.getTokenBalances(assets);
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for all assets of blockchain ${blockchain}:`, e);
      this.invalidateCacheFor(assets);
      return;
    }

    const tokenToBalanceMap = new Map<string, number>(
      tokenBalances.filter((t) => t.contractAddress).map((t) => [t.contractAddress.toLowerCase(), t.balance ?? 0]),
    );

    for (const asset of assets) {
      const balance =
        asset.type === AssetType.COIN ? coinBalance : tokenToBalanceMap.get(asset.chainId?.toLowerCase()) ?? 0;

      this.balanceCache.set(asset.id, balance);
    }
  }

  private async getForBsc(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;

    const blockchain = assets[0].blockchain;
    const client = this.evmRegistryService.getClient(blockchain);

    const tokenTransactions = await client.getERC20Transactions(client.dfxAddress, 0);
    const recentTransactions = tokenTransactions.filter(
      (tx) =>
        new Date(+tx.timeStamp * 1000) > Util.minutesBefore(5, this.updateTimestamps.get(blockchain) ?? new Date(0)),
    );

    // update all assets with missing cache or with recent transactions
    const assetsToUpdate = assets.filter(
      (a) =>
        a.type === AssetType.COIN ||
        !this.balanceCache.has(a.id) ||
        recentTransactions.some((tx) => tx.contractAddress === a.chainId),
    );

    for (const asset of assetsToUpdate) {
      try {
        const balance =
          asset.type === AssetType.COIN ? await client.getNativeCoinBalance() : await client.getTokenBalance(asset);

        this.balanceCache.set(asset.id, balance);
      } catch (e) {
        this.logger.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  // --- HELPER METHODS --- //
  private invalidateCacheFor(assets: Asset[]) {
    assets.forEach((a) => this.balanceCache.delete(a.id));
  }
}
