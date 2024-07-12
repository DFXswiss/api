import { Contract, ethers } from 'ethers';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import UNISWAP_ROUTER_02_ABI from 'src/integration/blockchain/shared/evm/abi/uniswap-router02.abi.json';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { EvmTokenBalance } from '../shared/evm/dto/evm-token-balance.dto';
import { ScanApiResponse } from '../shared/evm/dto/scan-api-response.dto';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from '../shared/evm/interfaces';

export class BscClient extends EvmClient {
  private routerV2: Contract;

  private scanApiUrl: string;
  private scanApiKey: string;

  constructor(params: EvmClientParams) {
    super(params);

    this.scanApiUrl = params.scanApiUrl;
    this.scanApiKey = params.scanApiKey;

    // old v2 router
    this.routerV2 = new ethers.Contract(params.swapContractAddress, UNISWAP_ROUTER_02_ABI, this.wallet);
  }

  async testSwap(
    sourceToken: Asset,
    sourceAmount: number,
    targetToken: Asset,
  ): Promise<{ targetAmount: number; feeAmount: number }> {
    const sourceContract = new ethers.Contract(sourceToken.chainId, ERC20_ABI, this.wallet);
    const sourceTokenDecimals = await sourceContract.decimals();

    const targetContract = new ethers.Contract(targetToken.chainId, ERC20_ABI, this.wallet);
    const targetTokenDecimals = await targetContract.decimals();

    const inputAmount = EvmUtil.toWeiAmount(sourceAmount, sourceTokenDecimals);
    const outputAmounts = await this.routerV2.getAmountsOut(inputAmount, [sourceToken.chainId, targetToken.chainId]);

    return { targetAmount: EvmUtil.fromWeiAmount(outputAmounts[1], targetTokenDecimals), feeAmount: 0 };
  }

  async getNativeCoinTransactions(walletAddress: string, fromBlock: number): Promise<EvmCoinHistoryEntry[]> {
    return this.getBscHistory(walletAddress, fromBlock, 'txlist');
  }

  async getERC20Transactions(walletAddress: string, fromBlock: number): Promise<EvmTokenHistoryEntry[]> {
    return this.getBscHistory(walletAddress, fromBlock, 'tokentx');
  }

  private async getBscHistory<T>(walletAddress: string, fromBlock: number, type: string): Promise<T[]> {
    const params = {
      module: 'account',
      address: walletAddress,
      startblock: fromBlock,
      apikey: this.scanApiKey,
      sort: 'asc',
      action: type,
    };

    const { result, message } = await this.callBscScanApi({ method: 'GET', params });

    if (!Array.isArray(result)) throw new Error(`Failed to get ${type} transactions: ${result ?? message}`);

    return result;
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceForAddress(this.dfxAddress);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const balance = await this.provider.getBalance(address);

    return EvmUtil.fromWeiAmount(balance);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    const contract = this.getERC20ContractForDex(asset.chainId);
    const balance = await contract.balanceOf(address ?? this.dfxAddress);
    const token = await this.getTokenByContract(contract);

    return EvmUtil.fromWeiAmount(balance, token.decimals);
  }

  async getTokenBalances(assets: Asset[], address?: string): Promise<EvmTokenBalance[]> {
    return Util.asyncMap(assets, async (a) => ({
      contractAddress: a.chainId,
      balance: await this.getTokenBalance(a, address),
    }));
  }

  private async callBscScanApi<T>(config: HttpRequestConfig, nthTry = 10): Promise<ScanApiResponse<T>> {
    const requestConfig = { url: this.scanApiUrl, ...config };

    try {
      const response = await this.http.request<ScanApiResponse<T>>(requestConfig);
      if (response.status === '0' && typeof response.result === 'string') throw new Error(response.result);

      return response;
    } catch (e) {
      if (nthTry > 1 && (e.message?.includes('Max rate limit reached') || e.response?.status === 429)) {
        await Util.delay(1000);
        return this.callBscScanApi(requestConfig, nthTry - 1);
      }

      throw e;
    }
  }
}
