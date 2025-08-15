import { ethers } from 'ethers';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { GoldskyService, GoldskyTokenTransfer, GoldskyTransfer } from 'src/integration/goldsky/goldsky.service';
import { GoldskyNetwork } from 'src/integration/goldsky/goldsky.types';
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
    super({
      ...params,
      alchemyService: undefined, // Citrea not supported by Alchemy
    });
    this.goldsky = params.goldskyService;
  }

  // Alchemy method overrides
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

  async getNativeCoinTransactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    if (!this.goldsky) throw new Error('Goldsky service is missing');

    const transfers = await this.goldsky.getNativeCoinTransfers(
      GoldskyNetwork.CITREA_TESTNET,
      walletAddress,
      fromBlock,
      toBlock,
    );
    return this.mapGoldskyToEvmCoinHistory(transfers, walletAddress, direction);
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    if (!this.goldsky) throw new Error('Goldsky service is missing');

    const transfers = await this.goldsky.getTokenTransfers(
      GoldskyNetwork.CITREA_TESTNET,
      walletAddress,
      fromBlock,
      toBlock,
    );
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
        contractAddress: '',
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
        value: tx.value,
        tokenName: tx.tokenName || tx.tokenSymbol,
        tokenDecimal: tx.tokenDecimals?.toString(),
      }));
  }
}
