import { ethers } from 'ethers';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { GoldskyService, GoldskyTokenTransfer, GoldskyTransfer } from 'src/integration/goldsky/goldsky.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { Direction, EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from '../shared/evm/interfaces';

export class CitreaTestnetClient extends EvmClient {
  private readonly logger = new DfxLogger(CitreaTestnetClient);

  private readonly goldsky?: GoldskyService;

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
      this.logger.error(`Failed to get token balance for ${asset.chainId}:`, error);
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

  // Transaction history methods - Require Goldsky service for transaction history
  async getNativeCoinTransactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    if (!this.goldsky) {
      throw new Error('CitreaTestnet: Goldsky service is required for transaction history. Please configure CITREA_TESTNET_GOLDSKY_SUBGRAPH_URL.');
    }

    const transfers = await this.goldsky.getNativeCoinTransfers('citrea-testnet', walletAddress, fromBlock, toBlock);
    return this.mapGoldskyToEvmCoinHistory(transfers, walletAddress, direction);
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    if (!this.goldsky) {
      throw new Error('CitreaTestnet: Goldsky service is required for ERC20 transaction history. Please configure CITREA_TESTNET_GOLDSKY_SUBGRAPH_URL.');
    }

    const transfers = await this.goldsky.getTokenTransfers('citrea-testnet', walletAddress, fromBlock, toBlock);
    return this.mapGoldskyToEvmTokenHistory(transfers, walletAddress, direction);
  }

  private mapGoldskyToEvmCoinHistory(
    transfers: GoldskyTransfer[],
    walletAddress: string,
    direction: Direction,
  ): EvmCoinHistoryEntry[] {
    const lowerWallet = walletAddress.toLowerCase();

    return transfers
      .filter((tx) => {
        if (direction === Direction.INCOMING) {
          return tx.to.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map((tx) => ({
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
      .filter((tx) => {
        if (direction === Direction.INCOMING) {
          return tx.to.toLowerCase() === lowerWallet;
        } else if (direction === Direction.OUTGOING) {
          return tx.from.toLowerCase() === lowerWallet;
        }
        return true; // Direction.BOTH
      })
      .map((tx) => ({
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
