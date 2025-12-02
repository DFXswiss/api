import { Injectable } from '@nestjs/common';
import { ChainId } from '@uniswap/sdk-core';

import {
  Alchemy,
  BigNumber as AlchemyBigNumber,
  Network as AlchemyNetwork,
  Utils as AlchemyUtils,
  AssetTransfersCategory,
  AssetTransfersWithMetadataResponse,
  AssetTransfersWithMetadataResult,
  TokenBalance,
  TransactionResponse,
} from 'alchemy-sdk';
import { Observable, Subject, filter, map } from 'rxjs';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { AlchemyNetworkMapper } from '../alchemy-network-mapper';
import { AlchemyAssetTransfersDto } from '../dto/alchemy-asset-transfers.dto';
import { AlchemySyncTransactionsDto } from '../dto/alchemy-sync-transactions.dto';

export interface AssetTransfersParams {
  fromAddress?: string;
  toAddress?: string;
  fromBlock: number;
  toBlock?: number;
  categories: AssetTransfersCategory[];
}

@Injectable()
export class AlchemyService {
  private readonly alchemyMap = new Map<AlchemyNetwork, Alchemy>();

  private readonly assetTransfersSubject: Subject<AlchemyAssetTransfersDto>;

  constructor() {
    this.assetTransfersSubject = new Subject<AlchemyAssetTransfersDto>();
  }

  getAssetTransfersObservable(blockchain: Blockchain): Observable<AssetTransfersWithMetadataResult[]> {
    return this.assetTransfersSubject.asObservable().pipe(
      filter((data) => blockchain === data.blockchain),
      map((data) => data.assetTransfers),
    );
  }

  getNativeCoinCategories(chainId: ChainId): AssetTransfersCategory[] {
    const alchemy = this.getAlchemy(chainId);

    return [AlchemyNetwork.ETH_MAINNET, AlchemyNetwork.ETH_GOERLI, AlchemyNetwork.ETH_SEPOLIA].includes(
      alchemy.config.network,
    )
      ? [AssetTransfersCategory.EXTERNAL, AssetTransfersCategory.INTERNAL]
      : [AssetTransfersCategory.EXTERNAL];
  }

  getERC20Categories(_chainId: ChainId): AssetTransfersCategory[] {
    return [AssetTransfersCategory.ERC20];
  }

  async getNativeCoinBalance(chainId: ChainId, address: string, blockTag?: number | 'latest'): Promise<AlchemyBigNumber> {
    const alchemy = this.getAlchemy(chainId);

    return alchemy.core.getBalance(address, blockTag ?? 'latest');
  }

  async getTokenBalances(chainId: ChainId, address: string, assets: Asset[]): Promise<TokenBalance[]> {
    const alchemy = this.getAlchemy(chainId);

    const contractAddresses = assets.filter((a) => a.chainId != null).map((a) => a.chainId);

    return Util.retry(async () => {
      const response = await alchemy.core.getTokenBalances(address, contractAddresses);
      if (!response) throw new Error(`Failed to get token balances for address ${address} on chain ${chainId}`);

      return response.tokenBalances;
    }, 3);
  }

  async getTokenBalanceAtBlock(
    chainId: ChainId,
    address: string,
    contractAddress: string,
    blockNumber: number,
  ): Promise<string> {
    const alchemy = this.getAlchemy(chainId);

    const data = alchemy.core.call(
      {
        to: contractAddress,
        data: `0x70a08231000000000000000000000000${address.slice(2).toLowerCase()}`, // balanceOf(address)
      },
      blockNumber,
    );

    return data;
  }

  async getBlock(chainId: ChainId, blockNumber: number): Promise<{ timestamp: number } | null> {
    const alchemy = this.getAlchemy(chainId);
    return alchemy.core.getBlock(blockNumber);
  }

  async findBlockByTimestamp(chainId: ChainId, targetTimestamp: number): Promise<number> {
    const alchemy = this.getAlchemy(chainId);

    const currentBlock = await alchemy.core.getBlockNumber();
    let low = 1;
    let high = currentBlock;
    let bestBlock = high;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const block = await alchemy.core.getBlock(mid);

      if (!block || !block.timestamp) {
        throw new Error(`Failed to get block ${mid}`);
      }

      if (block.timestamp <= targetTimestamp) {
        bestBlock = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestBlock;
  }

  async getBlockNumber(blockchain: Blockchain): Promise<number> {
    const chainId = EvmUtil.getChainId(blockchain);
    const alchemy = this.getAlchemy(chainId);

    return alchemy.core.getBlockNumber();
  }

  async getAssetTransfers(chainId: ChainId, params: AssetTransfersParams): Promise<AssetTransfersWithMetadataResult[]> {
    if (params.toBlock && params.toBlock < params.fromBlock) return [];

    const alchemy = this.getAlchemy(chainId);

    let assetTransfersResponse = await this.alchemyGetAssetTransfers(alchemy, params);
    let pageKey = assetTransfersResponse.pageKey;

    const assetTransferResult = assetTransfersResponse.transfers;

    while (pageKey) {
      assetTransfersResponse = await this.alchemyGetAssetTransfers(alchemy, params, pageKey);
      pageKey = assetTransfersResponse.pageKey;

      assetTransferResult.push(...assetTransfersResponse.transfers);
    }

    return assetTransferResult;
  }

  private async alchemyGetAssetTransfers(
    alchemy: Alchemy,
    params: AssetTransfersParams,
    pageKey?: string,
  ): Promise<AssetTransfersWithMetadataResponse> {
    if (!alchemy) throw new Error('Alchemy not available');

    return alchemy.core.getAssetTransfers({
      fromBlock: AlchemyUtils.hexlify(params.fromBlock),
      toBlock: params.toBlock ? AlchemyUtils.hexlify(params.toBlock) : undefined,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      category: params.categories,
      excludeZeroValue: false,
      pageKey: pageKey,
      withMetadata: true,
    });
  }

  async syncTransactions(syncTransactions: AlchemySyncTransactionsDto) {
    const blockchain = syncTransactions.blockchain;
    const chainId = EvmUtil.getChainId(blockchain);

    const categories = this.getNativeCoinCategories(chainId);
    categories.push(...this.getERC20Categories(chainId));

    const params: AssetTransfersParams = {
      fromAddress: undefined,
      toAddress: syncTransactions.address,
      fromBlock: syncTransactions.fromBlock,
      toBlock: syncTransactions.toBlock,
      categories: categories,
    };

    const assetTransfers = await this.getAssetTransfers(chainId, params);

    if (assetTransfers.length) {
      assetTransfers.sort((atr1, atr2) => Number(atr1.blockNum) - Number(atr2.blockNum));

      this.assetTransfersSubject.next({ blockchain, assetTransfers });
    }
  }

  async sendTransaction(chainId: ChainId, tx: string): Promise<TransactionResponse> {
    const alchemy = this.getAlchemy(chainId);
    return alchemy.transact.sendTransaction(tx);
  }

  async getTransaction(chainId: ChainId, txId: string): Promise<TransactionResponse | null> {
    const alchemy = this.getAlchemy(chainId);
    return alchemy.transact.getTransaction(txId);
  }

  // --- Alchemy Setup --- //

  private getAlchemy(chainId: ChainId): Alchemy {
    const alchemyNetwork = AlchemyNetworkMapper.toAlchemyNetworkByChainId(chainId);
    if (!alchemyNetwork) throw new Error(`Alchemy not available for chain id ${chainId}`);

    const alchemy = this.alchemyMap.get(alchemyNetwork);
    return alchemy ?? this.setupAlchemy(alchemyNetwork);
  }

  private setupAlchemy(alchemyNetwork: AlchemyNetwork): Alchemy {
    const alchemySettings = {
      apiKey: Config.alchemy.apiKey,
      authToken: Config.alchemy.authToken,
      network: alchemyNetwork,
    };

    const alchemy = new Alchemy(alchemySettings);
    this.alchemyMap.set(alchemyNetwork, alchemy);

    return alchemy;
  }
}
