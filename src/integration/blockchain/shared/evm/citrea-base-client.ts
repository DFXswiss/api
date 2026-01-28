import { CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import { FeeAmount, Pool, Route, SwapQuoter } from '@uniswap/v3-sdk';
import { Contract, ethers } from 'ethers';
import {
  BlockscoutTokenTransfer,
  BlockscoutTransaction,
} from 'src/integration/blockchain/shared/blockscout/blockscout.service';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import SWAP_GATEWAY_ABI from 'src/integration/blockchain/shared/evm/abi/juiceswap-gateway.abi.json';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../dto/blockchain-token-balance.dto';
import { Direction, EvmClient, EvmClientParams } from './evm-client';
import { EvmUtil } from './evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

export abstract class CitreaBaseClient extends EvmClient {
  protected readonly citreaQuoteContractAddress: string;

  constructor(params: EvmClientParams) {
    super({
      ...params,
      alchemyService: undefined, // Citrea not supported by Alchemy
      swapContractAddress: undefined, // Prevent AlphaRouter init (no Multicall on Citrea)
    });
    this.citreaQuoteContractAddress = params.quoteContractAddress;
  }

  // --- BALANCE METHODS --- //

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

  protected async getPoolTokenBalance(asset: Asset, poolAddress: string): Promise<number> {
    try {
      const { jusd, svJusd } = await this.getGatewayTokenAddresses();
      const isJusd = asset.chainId.toLowerCase() === jusd.toLowerCase();
      const tokenAddress = isJusd ? svJusd : asset.chainId;

      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await contract.balanceOf(poolAddress);
      const decimals = await contract.decimals();

      if (isJusd) {
        const gateway = this.getSwapGatewayContract();
        const jusdBalance = await gateway.svJusdToJusd(balance);
        return EvmUtil.fromWeiAmount(jusdBalance.toString(), decimals);
      }

      return EvmUtil.fromWeiAmount(balance.toString(), decimals);
    } catch (error) {
      this.logger.error(`Failed to get pool token balance for ${asset.chainId}:`, error);
      return 0;
    }
  }

  override async getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]> {
    const owner = address ?? this.walletAddress;
    const isPoolBalance = address !== undefined && address !== this.walletAddress;
    const balances: BlockchainTokenBalance[] = [];

    for (const asset of assets) {
      const balance = isPoolBalance
        ? await this.getPoolTokenBalance(asset, owner)
        : await this.getTokenBalance(asset, owner);
      balances.push({
        owner,
        contractAddress: asset.chainId,
        balance,
      });
    }

    return balances;
  }

  // --- HISTORY METHODS --- //

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
        return true;
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
        return true;
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

  // --- SWAP GATEWAY METHODS --- //

  private getSwapGatewayContract(): Contract {
    if (!this.swapGatewayAddress) {
      throw new Error('Swap Gateway address not configured');
    }
    return new Contract(this.swapGatewayAddress, SWAP_GATEWAY_ABI, this.wallet);
  }

  private async getGatewayTokenAddresses(): Promise<{ jusd: string; svJusd: string }> {
    const gateway = this.getSwapGatewayContract();
    const [jusd, svJusd] = await Promise.all([gateway.JUSD(), gateway.SV_JUSD()]);
    return { jusd, svJusd };
  }

  private async resolvePoolTokenAddresses(
    asset1: Asset,
    asset2: Asset,
  ): Promise<{ address1: string; address2: string; isJusd1: boolean; isJusd2: boolean }> {
    const { jusd, svJusd } = await this.getGatewayTokenAddresses();

    const isJusd1 = asset1.chainId.toLowerCase() === jusd.toLowerCase();
    const isJusd2 = asset2.chainId.toLowerCase() === jusd.toLowerCase();

    return {
      address1: isJusd1 ? svJusd : asset1.chainId,
      address2: isJusd2 ? svJusd : asset2.chainId,
      isJusd1,
      isJusd2,
    };
  }

  private async getGatewayPool(tokenA: string, tokenB: string, fee: FeeAmount): Promise<string> {
    const gateway = this.getSwapGatewayContract();
    return gateway.getPool(tokenA, tokenB, fee);
  }

  private async swapViaGateway(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    fee: FeeAmount = FeeAmount.MEDIUM,
    decimalsIn = 18,
    decimalsOut = 18,
    isInputNativeCoin = false,
    isOutputNativeCoin = false,
  ): Promise<string> {
    const gateway = this.getSwapGatewayContract();

    const weiAmountIn = EvmUtil.toWeiAmount(amountIn, decimalsIn);
    const weiMinAmountOut = EvmUtil.toWeiAmount(minAmountOut, decimalsOut);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    const gasPrice = await this.getRecommendedGasPrice();

    const actualTokenIn = isInputNativeCoin ? ethers.constants.AddressZero : tokenIn;
    const actualTokenOut = isOutputNativeCoin ? ethers.constants.AddressZero : tokenOut;

    const tx = await gateway.swapExactTokensForTokens(
      actualTokenIn,
      actualTokenOut,
      fee,
      weiAmountIn,
      weiMinAmountOut,
      this.wallet.address,
      deadline,
      { gasPrice, ...(isInputNativeCoin ? { value: weiAmountIn } : {}) },
    );

    return tx.hash;
  }

  // --- TRADING INTEGRATION --- //

  override async getPoolAddress(asset1: Asset, asset2: Asset, poolFee: FeeAmount): Promise<string> {
    const { address1, address2 } = await this.resolvePoolTokenAddresses(asset1, asset2);
    return this.getGatewayPool(address1, address2, poolFee);
  }

  private async getTokenPairByAddresses(address1: string, address2: string): Promise<[Token, Token]> {
    const contract1 = this.getERC20ContractForDex(address1);
    const contract2 = this.getERC20ContractForDex(address2);

    const [decimals1, decimals2] = await Promise.all([contract1.decimals(), contract2.decimals()]);

    return [new Token(this.chainId, address1, decimals1), new Token(this.chainId, address2, decimals2)];
  }

  override async testSwapPool(
    source: Asset,
    sourceAmount: number,
    target: Asset,
    poolFee: FeeAmount,
  ): Promise<{ targetAmount: number; feeAmount: number; priceImpact: number }> {
    if (source.id === target.id) return { targetAmount: sourceAmount, feeAmount: 0, priceImpact: 0 };

    const {
      address1: sourceAddress,
      address2: targetAddress,
      isJusd1: sourceIsJusd,
      isJusd2: targetIsJusd,
    } = await this.resolvePoolTokenAddresses(source, target);
    const gateway = this.getSwapGatewayContract();

    // If source is JUSD, convert input amount to svJUSD equivalent
    let poolSourceAmount = sourceAmount;
    if (sourceIsJusd) {
      const sourceAmountWei = EvmUtil.toWeiAmount(sourceAmount, source.decimals);
      const svJusdAmountWei = await gateway.jusdToSvJusd(sourceAmountWei);
      poolSourceAmount = EvmUtil.fromWeiAmount(svJusdAmountWei, 18);
    }

    const [sourceToken, targetToken] = await this.getTokenPairByAddresses(sourceAddress, targetAddress);

    const poolAddress = await this.getGatewayPool(sourceAddress, targetAddress, poolFee);
    const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI.abi, this.wallet);

    const token0IsInToken = sourceToken.address.toLowerCase() === (await poolContract.token0()).toLowerCase();
    const [liquidity, slot0] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);
    const sqrtPriceX96 = slot0.sqrtPriceX96;

    const pool = new Pool(sourceToken, targetToken, poolFee, slot0[0].toString(), liquidity.toString(), slot0[1]);
    const route = new Route([pool], sourceToken, targetToken);

    const sourceAmountWei = EvmUtil.toWeiAmount(poolSourceAmount, sourceToken.decimals);
    const currencyAmount = CurrencyAmount.fromRawAmount(sourceToken, sourceAmountWei.toString());

    const { calldata } = SwapQuoter.quoteCallParameters(route, currencyAmount, TradeType.EXACT_INPUT, {
      useQuoterV2: true,
    });

    const quoteCallReturnData = await this.provider.call({
      to: this.citreaQuoteContractAddress,
      data: calldata,
    });

    const amountOutHex = ethers.utils.hexDataSlice(quoteCallReturnData, 0, 32);
    const amountOut = ethers.BigNumber.from(amountOutHex);

    // If target is JUSD, convert svJUSD output to JUSD
    let finalAmountOut = amountOut;
    if (targetIsJusd) {
      finalAmountOut = await gateway.svJusdToJusd(amountOut);
    }

    // Calculate price impact
    const expectedOut = sourceAmountWei.mul(sqrtPriceX96).mul(sqrtPriceX96).div(ethers.BigNumber.from(2).pow(192));
    const priceImpact = token0IsInToken
      ? Math.abs(1 - +amountOut / +expectedOut)
      : Math.abs(1 - +expectedOut / +amountOut);

    const gasPrice = await this.getRecommendedGasPrice();
    const estimatedGas = ethers.BigNumber.from(300000);

    return {
      targetAmount: EvmUtil.fromWeiAmount(finalAmountOut, target.decimals),
      feeAmount: EvmUtil.fromWeiAmount(estimatedGas.mul(gasPrice)),
      priceImpact,
    };
  }

  override async swapPool(
    source: Asset,
    target: Asset,
    sourceAmount: number,
    poolFee: FeeAmount,
    maxSlippage: number,
  ): Promise<string> {
    const quote = await this.testSwapPool(source, sourceAmount, target, poolFee);
    const minAmountOut = quote.targetAmount * (1 - maxSlippage);

    const isInputNativeCoin = source.type === AssetType.COIN;
    const isOutputNativeCoin = target.type === AssetType.COIN;

    return this.swapViaGateway(
      source.chainId,
      target.chainId,
      sourceAmount,
      minAmountOut,
      poolFee,
      source.decimals,
      target.decimals,
      isInputNativeCoin,
      isOutputNativeCoin,
    );
  }
}
