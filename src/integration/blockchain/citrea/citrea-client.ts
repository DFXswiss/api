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

export class CitreaClient extends EvmClient {
  protected override readonly logger = new DfxLogger(CitreaClient);

  private readonly goldsky?: GoldskyService;
  private readonly maxRpcBlockRange = 100;

  constructor(params: EvmClientParams) {
    super({
      ...params,
      alchemyService: undefined, // Citrea not supported by Alchemy
    });
    this.goldsky = params.goldskyService;
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
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    try {
      const transfers = await this.goldsky.getNativeCoinTransfers(
        GoldskyNetwork.CITREA,
        walletAddress,
        fromBlock,
        toBlock,
      );
      return this.mapGoldskyToEvmCoinHistory(transfers, walletAddress, direction);
    } catch (error) {
      this.logger.warn(`Goldsky service failed, using RPC fallback: ${error.message}`);
    }

    // fallback: get transactions using RPC (limited functionality)
    return this.getNativeCoinTransactionsViaRPC(walletAddress, fromBlock, toBlock, direction);
  }

  async getERC20Transactions(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    try {
      const transfers = await this.goldsky.getTokenTransfers(GoldskyNetwork.CITREA, walletAddress, fromBlock, toBlock);
      return this.mapGoldskyToEvmTokenHistory(transfers, walletAddress, direction);
    } catch (error) {
      this.logger.warn(`Goldsky service failed, using RPC fallback: ${error.message}`);
    }

    // fallback: get token transactions using RPC (limited functionality)
    return this.getERC20TransactionsViaRPC(walletAddress, fromBlock, toBlock, direction);
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

  private async getNativeCoinTransactionsViaRPC(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    // This is a simplified fallback that only gets recent block transactions
    // It's not as efficient as the subgraph but provides basic functionality
    const transactions: EvmCoinHistoryEntry[] = [];
    const lowerWallet = walletAddress.toLowerCase();
    const endBlock = toBlock ?? (await this.provider.getBlockNumber());

    // Limit the range to avoid overwhelming the RPC
    const startBlock = Math.max(fromBlock, endBlock - this.maxRpcBlockRange);

    this.logger.info(`Fetching transactions via RPC from block ${startBlock} to ${endBlock}`);

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
      try {
        const block = await this.provider.getBlockWithTransactions(blockNum);
        if (!block) continue;

        for (const tx of block.transactions) {
          const fromMatch = tx.from?.toLowerCase() === lowerWallet;
          const toMatch = tx.to?.toLowerCase() === lowerWallet;

          if (
            (direction === Direction.INCOMING && !toMatch) ||
            (direction === Direction.OUTGOING && !fromMatch) ||
            (direction === Direction.BOTH && !fromMatch && !toMatch)
          )
            continue;

          transactions.push({
            blockNumber: blockNum.toString(),
            timeStamp: block.timestamp.toString(),
            hash: tx.hash,
            from: tx.from,
            to: tx.to || '',
            value: tx.value.toString(),
            contractAddress: '',
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch block ${blockNum}: ${error.message}`);
      }
    }

    return transactions;
  }

  private async getERC20TransactionsViaRPC(
    walletAddress: string,
    fromBlock: number,
    toBlock?: number,
    direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    // For ERC20 transactions, we need to use event logs
    const transactions: EvmTokenHistoryEntry[] = [];
    const lowerWallet = walletAddress.toLowerCase();
    const endBlock = toBlock ?? (await this.provider.getBlockNumber());

    // Limit the range to avoid overwhelming the RPC
    const startBlock = Math.max(fromBlock, endBlock - this.maxRpcBlockRange);

    this.logger.info(`Fetching ERC20 transfers via RPC from block ${startBlock} to ${endBlock}`);

    // ERC20 Transfer event signature
    const transferEventSignature = ethers.utils.id('Transfer(address,address,uint256)');

    try {
      // Create filters for incoming and outgoing transfers
      const filters = [];

      if (direction === Direction.INCOMING || direction === Direction.BOTH) {
        filters.push({
          topics: [
            transferEventSignature,
            null, // from (any)
            ethers.utils.hexZeroPad(lowerWallet, 32), // to (our address)
          ],
          fromBlock: startBlock,
          toBlock: endBlock,
        });
      }

      if (direction === Direction.OUTGOING || direction === Direction.BOTH) {
        filters.push({
          topics: [
            transferEventSignature,
            ethers.utils.hexZeroPad(lowerWallet, 32), // from (our address)
            null, // to (any)
          ],
          fromBlock: startBlock,
          toBlock: endBlock,
        });
      }

      for (const filter of filters) {
        const logs = await this.provider.getLogs(filter);

        for (const log of logs) {
          const block = await this.provider.getBlock(log.blockNumber);

          // Decode the transfer event
          const decoded = ethers.utils.defaultAbiCoder.decode(['uint256'], log.data);

          transactions.push({
            blockNumber: log.blockNumber.toString(),
            timeStamp: block.timestamp.toString(),
            hash: log.transactionHash,
            from: ethers.utils.getAddress('0x' + log.topics[1].slice(26)),
            contractAddress: log.address,
            to: ethers.utils.getAddress('0x' + log.topics[2].slice(26)),
            value: decoded[0].toString(),
            tokenName: '',
            tokenDecimal: '',
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch ERC20 transfers: ${error.message}`);
    }

    // Remove duplicates (same tx might appear in both incoming and outgoing)
    const uniqueTransactions = transactions.filter(
      (tx, index, self) =>
        index === self.findIndex((t) => t.hash === tx.hash && t.contractAddress === tx.contractAddress),
    );

    return uniqueTransactions;
  }
}
