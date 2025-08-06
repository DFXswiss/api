import { ethers } from 'ethers';
import { EvmClient, EvmClientParams, Direction } from '../shared/evm/evm-client';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from '../shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { EvmUtil } from '../shared/evm/evm.util';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';

export class CitreaTestnetClient extends EvmClient {
  constructor(params: EvmClientParams) {
    // Pass params without alchemyService since Citrea isn't supported by Alchemy
    super({
      ...params,
      alchemyService: undefined, // Explicitly set to undefined
    });
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

  // Transaction history methods - return empty for now as Citrea doesn't have Alchemy indexer
  async getNativeCoinTransactions(
    _walletAddress: string,
    _fromBlock: number,
    _toBlock?: number,
    _direction = Direction.BOTH,
  ): Promise<EvmCoinHistoryEntry[]> {
    console.warn('CitreaTestnet: Transaction history not available without Alchemy indexer');
    return [];
  }

  async getERC20Transactions(
    _walletAddress: string,
    _fromBlock: number,
    _toBlock?: number,
    _direction = Direction.BOTH,
  ): Promise<EvmTokenHistoryEntry[]> {
    console.warn('CitreaTestnet: ERC20 transaction history not available without Alchemy indexer');
    return [];
  }
}