import { Injectable } from '@nestjs/common';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { CardanoClient } from 'src/integration/blockchain/cardano/cardano-client';
import { InternetComputerClient } from 'src/integration/blockchain/icp/icp-client';
import { BlockchainTokenBalance } from 'src/integration/blockchain/shared/dto/blockchain-token-balance.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { TronClient } from 'src/integration/blockchain/tron/tron-client';
import { ZanoClient } from 'src/integration/blockchain/zano/zano-client';
import { isAsset } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration } from '../../interfaces';

type TokenClient = EvmClient | SolanaClient | TronClient | ZanoClient | CardanoClient | InternetComputerClient;

@Injectable()
export class BlockchainAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(BlockchainAdapter);

  private readonly refreshInterval = 45; // seconds

  private readonly balanceCache = new Map<number, number>();
  private readonly updateCalls = new Map<Blockchain, Promise<void>>();
  private readonly updateTimestamps = new Map<Blockchain, Date>();

  constructor(
    private readonly dexService: DexService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
  ) {}

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

  async hasPendingOrders(asset: Asset): Promise<boolean> {
    return this.dexService.hasPendingOrders(asset);
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
    if (!this.updateCalls.has(blockchain)) {
      this.updateCalls.set(blockchain, this.updateBalancesFor(blockchain, assets));
    }

    return this.updateCalls.get(blockchain);
  }

  private async updateBalancesFor(blockchain: Blockchain, assets: Asset[]): Promise<void> {
    const updated = new Date();

    try {
      switch (blockchain) {
        case Blockchain.BITCOIN:
          await this.updateCoinOnlyBalance(assets, BitcoinNodeType.BTC_OUTPUT);
          break;

        case Blockchain.LIGHTNING:
        case Blockchain.FIRO:
        case Blockchain.MONERO:
          await this.updateCoinOnlyBalance(assets);
          break;

        case Blockchain.ZANO:
        case Blockchain.SOLANA:
        case Blockchain.TRON:
        case Blockchain.CARDANO:
        case Blockchain.INTERNET_COMPUTER:
          await this.updateTokenClientBalance(assets);
          break;

        case Blockchain.ETHEREUM:
        case Blockchain.SEPOLIA:
        case Blockchain.OPTIMISM:
        case Blockchain.ARBITRUM:
        case Blockchain.POLYGON:
        case Blockchain.BASE:
        case Blockchain.GNOSIS:
        case Blockchain.BINANCE_SMART_CHAIN:
        case Blockchain.CITREA:
        case Blockchain.CITREA_TESTNET:
          await this.updateEvmBalance(assets);
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

  private async updateCoinOnlyBalance(assets: Asset[], bitcoinNodeType?: BitcoinNodeType.BTC_OUTPUT): Promise<void> {
    for (const asset of assets) {
      try {
        if (asset.type !== AssetType.COIN) throw new Error(`Only coins are available on ${asset.blockchain}`);

        const client = this.blockchainRegistryService.getCoinOnlyClient(asset.blockchain, bitcoinNodeType);
        const balance = await client.getNativeCoinBalance();
        this.balanceCache.set(asset.id, balance);
      } catch (e) {
        this.logger.error(`Failed to update liquidity management balance for ${asset.uniqueName}:`, e);
        this.invalidateCacheFor([asset]);
      }
    }
  }

  private async updateTokenClientBalance(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;

    const blockchain = assets[0].blockchain;
    const client = this.blockchainRegistryService.getClient(blockchain) as TokenClient;

    await this.updateCoinAndTokenBalance(
      assets.filter((a) => a.type !== AssetType.POOL),
      client,
    );
  }

  private async updateEvmBalance(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;

    const blockchain = assets[0].blockchain;
    const client = this.blockchainRegistryService.getEvmClient(blockchain);

    await this.updateCoinAndTokenBalance(
      assets.filter((a) => a.type !== AssetType.POOL),
      client,
    );
    await this.updateEvmPosition(
      assets.filter((a) => a.type === AssetType.POOL),
      client,
    );
  }

  private async updateCoinAndTokenBalance(assets: Asset[], client: TokenClient): Promise<void> {
    let coinBalance: number;
    let tokenBalances: BlockchainTokenBalance[];

    try {
      coinBalance = await client.getNativeCoinBalance();
      tokenBalances = await client.getTokenBalances(assets);
    } catch (e) {
      this.logger.error(`Failed to update balance for assets of blockchain ${assets[0].blockchain}:`, e);
      this.invalidateCacheFor(assets);
      return;
    }

    const tokenToBalanceMap = new Map<string, number>(
      tokenBalances.filter((t) => t.contractAddress).map((t) => [t.contractAddress.toLowerCase(), t.balance ?? 0]),
    );

    for (const asset of assets) {
      const balance = asset.type === AssetType.COIN ? coinBalance : tokenToBalanceMap.get(asset.chainId?.toLowerCase());

      const previousBalance = this.balanceCache.get(asset.id);
      if (previousBalance && !balance) this.logger.error(`Balance for ${asset.uniqueName} went to ${null}`);

      if (balance != null) this.balanceCache.set(asset.id, balance);
    }
  }

  private async updateEvmPosition(assets: Asset[], client: EvmClient): Promise<void> {
    const assetMap = Util.groupByAccessor(assets, (a) => a.chainId.split('/').slice(0, 2).join('/'));

    for (const pool of new Set(assetMap.keys())) {
      try {
        const [positionsNft, positionId] = pool.split('/');
        const amounts = await client.getUniswapLiquidity(positionsNft, +positionId);

        for (const asset of assetMap.get(pool)) {
          const balance = amounts[+asset.chainId.split('/').pop()];
          this.balanceCache.set(asset.id, balance);
        }
      } catch (e) {
        this.logger.error(`Failed to update balance for pools of blockchain ${assets[0].blockchain}:`, e);
        this.invalidateCacheFor(assetMap.get(pool));
      }
    }
  }

  // --- HELPER METHODS --- //
  private invalidateCacheFor(assets: Asset[]) {
    assets.forEach((a) => this.balanceCache.delete(a.id));
  }
}
