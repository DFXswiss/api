import { ethers } from 'ethers';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import {
  BlockscoutTokenTransfer,
  BlockscoutTransaction,
} from 'src/integration/blockchain/shared/blockscout/blockscout.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { Direction, EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from '../shared/evm/interfaces';

export class CitreaTestnetClient extends EvmClient {
  protected override readonly logger = new DfxLogger(CitreaTestnetClient);

  constructor(params: EvmClientParams) {
    super({
      ...params,
      alchemyService: undefined, // Citrea not supported by Alchemy
    });
  }

  // Alchemy method overrides
  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.walletAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.provider.getBalance(address);
    return EvmUtil.fromWeiAmount(balance.toString());
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const owner = address ?? this.walletAddress;
    const contract = new ethers.Contract(asset.chainId, ERC20_ABI, this.provider);

    try {
      const balance = await contract.balanceOf(owner);
      const decimals = await contract.decimals();
      return EvmUtil.fromWeiAmount(balance.toString(), decimals);
    } catch (error) {
      this.logger.error(`Failed to get token balance for ${asset.chainId}:`, error);
      return 0;
    }
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.walletAddress;
    const balances: BlockchainTokenBalance[] = [];

    for (const asset of assets) {
      const balance = await this.getTokenBalance(asset, owner);
      balances.push({
        owner,
        contractAddress: asset.chainId,
        balance,
      });
    }

    return balances;
  }

  // --- HISTORY --- //

  async getNativeCoinTransactions(
    walletAddress: string,
    fromBlock: number,
    _toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    const transactions = await this.blockscoutService.getTransactions(this.blockscoutApiUrl, walletAddress, fromBlock);
    return this.mapBlockscoutToEvmCoinHistory(transactions, walletAddress, direction);
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    _toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    const transfers = await this.blockscoutService.getTokenTransfers(this.blockscoutApiUrl, walletAddress, fromBlock);
    return this.mapBlockscoutToEvmTokenHistory(transfers, walletAddress, direction);
  }

  private mapBlockscoutToEvmCoinHistory(
    transactions: BlockscoutTransaction[],
    walletAddress: string,
    direction: Direction,
  ): EvmCoinHistoryEntry[] {
    const lowerWallet = walletAddress.toLowerCase();

    return transactions
      .filter((tx) => {
        if (direction === Direction.INCOMING) {
          return tx.to?.hash.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.hash.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map((tx) => ({
        blockNumber: tx.block_number.toString(),
        timeStamp: tx.timestamp,
        hash: tx.hash,
        from: tx.from.hash,
        to: tx.to?.hash || '',
        value: tx.value,
        contractAddress: '',
      }));
  }

  private mapBlockscoutToEvmTokenHistory(
    transfers: BlockscoutTokenTransfer[],
    walletAddress: string,
    direction: Direction,
  ): EvmTokenHistoryEntry[] {
    const lowerWallet = walletAddress.toLowerCase();

    return transfers
      .filter((tx) => {
        if (direction === Direction.INCOMING) {
          return tx.to.hash.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.hash.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map((tx) => ({
        blockNumber: tx.block_number.toString(),
        timeStamp: tx.timestamp,
        hash: tx.tx_hash,
        from: tx.from.hash,
        contractAddress: tx.token.address,
        to: tx.to.hash,
        value: tx.total.value,
        tokenName: tx.token.name || tx.token.symbol,
        tokenDecimal: tx.total.decimals || tx.token.decimals,
      }));
  }
}
