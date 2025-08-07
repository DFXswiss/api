import { ethers } from 'ethers';
import { EvmClient, EvmClientParams, Direction } from '../shared/evm/evm-client';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from '../shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { EvmUtil } from '../shared/evm/evm.util';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { GoldskyService, GoldskyTransfer, GoldskyTokenTransfer } from 'src/integration/goldsky/goldsky.service';

export class CitreaTestnetClient extends EvmClient {
  private readonly goldsky: GoldskyService;

  constructor(params: EvmClientParams) {
    // Pass params without alchemyService since Citrea isn't supported by Alchemy
    super({
      ...params,
      alchemyService: undefined, // Explicitly set to undefined
    });
    this.goldsky = params.goldskyService;
  }

  // Override Alchemy-dependent methods with direct RPC calls
  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.dfxAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.provider.getBalance(address);
    return EvmUtil.fromWeiAmount(balance.toString());
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const owner = address ?? this.dfxAddress;
    const contract = new ethers.Contract(asset.chainId, ERC20_ABI, this.provider);
    
    try {
      const balance = await contract.balanceOf(owner);
      const decimals = await contract.decimals();
      return EvmUtil.fromWeiAmount(balance.toString(), decimals);
    } catch (error) {
      console.error(`Failed to get token balance for ${asset.chainId}:`, error);
      return 0;
    }
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.dfxAddress;
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

  // Transaction history methods - Use Goldsky if available, otherwise return empty
  async getNativeCoinTransactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    if (!this.goldsky) {
      console.warn('CitreaTestnet: Goldsky service not configured, transaction history not available');
      return [];
    }

    try {
      const transfers = await this.goldsky.getNativeCoinTransfers(
        'citrea-testnet',
        walletAddress,
        fromBlock,
        toBlock,
      );

      return this.mapGoldskyToEvmCoinHistory(transfers, walletAddress, direction);
    } catch (error) {
      console.error('Failed to fetch native coin transactions from Goldsky:', error);
      return [];
    }
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    if (!this.goldsky) {
      console.warn('CitreaTestnet: Goldsky service not configured, ERC20 transaction history not available');
      return [];
    }

    try {
      const transfers = await this.goldsky.getTokenTransfers(
        'citrea-testnet',
        walletAddress,
        fromBlock,
        toBlock,
      );

      return this.mapGoldskyToEvmTokenHistory(transfers, walletAddress, direction);
    } catch (error) {
      console.error('Failed to fetch ERC20 transactions from Goldsky:', error);
      return [];
    }
  }

  private mapGoldskyToEvmCoinHistory(
    transfers: GoldskyTransfer[],
    walletAddress: string,
    direction: Direction,
  ): EvmCoinHistoryEntry[] {
    const lowerWallet = walletAddress.toLowerCase();

    return transfers
      .filter(tx => {
        if (direction === Direction.INCOMING) {
          return tx.to.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map(tx => ({
        blockNumber: tx.blockNumber.toString(),
        timeStamp: tx.blockTimestamp.toString(),
        hash: tx.transactionHash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        contractAddress: '', // Native coin transfers don't have contract address
      }));
  }

  private mapGoldskyToEvmTokenHistory(
    transfers: GoldskyTokenTransfer[],
    walletAddress: string,
    direction: Direction,
  ): EvmTokenHistoryEntry[] {
    const lowerWallet = walletAddress.toLowerCase();

    return transfers
      .filter(tx => {
        if (direction === Direction.INCOMING) {
          return tx.to.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map(tx => ({
        blockNumber: tx.blockNumber.toString(),
        timeStamp: tx.blockTimestamp.toString(),
        hash: tx.transactionHash,
        from: tx.from,
        contractAddress: tx.contractAddress,
        to: tx.to,
        value: tx.value, // Token transfer amount
        tokenName: tx.tokenName || tx.tokenSymbol || 'UNKNOWN',
        tokenDecimal: tx.tokenDecimals?.toString() || '18',
      }));
  }
}