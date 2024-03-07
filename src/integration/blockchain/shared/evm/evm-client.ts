import { ChainId, Currency, CurrencyAmount, Ether, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, SwapRoute, SwapType } from '@uniswap/smart-order-router';
import { AssetTransfersCategory } from 'alchemy-sdk';
import { Contract, BigNumber as EthersNumber, ethers } from 'ethers';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from './abi/erc20.abi.json';
import { WalletAccount } from './domain/wallet-account';
import { EvmTokenBalance } from './dto/evm-token-balance.dto';
import { EvmUtil } from './evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

export interface EvmClientParams {
  http: HttpService;
  alchemyService?: AlchemyService;
  gatewayUrl: string;
  apiKey: string;
  walletPrivateKey: string;
  chainId: ChainId;
  swapContractAddress: string;
  scanApiUrl?: string;
  scanApiKey?: string;
}

interface AssetTransfersParams {
  fromAddress?: string;
  toAddress?: string;
  fromBlock: number;
  categories: AssetTransfersCategory[];
}

export abstract class EvmClient {
  protected http: HttpService;
  private alchemyService: AlchemyService;
  private chainId: ChainId;

  protected provider: ethers.providers.JsonRpcProvider;
  protected randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';
  protected wallet: ethers.Wallet;
  private nonce = new Map<string, number>();
  private tokens = new AsyncCache<Token>();
  private router: AlphaRouter;
  private swapContractAddress: string;

  constructor(params: EvmClientParams) {
    this.http = params.http;
    this.alchemyService = params.alchemyService;
    this.chainId = params.chainId;

    const url = `${params.gatewayUrl}/${params.apiKey ?? ''}`;
    this.provider = new ethers.providers.JsonRpcProvider(url);

    this.wallet = new ethers.Wallet(params.walletPrivateKey, this.provider);

    this.router = new AlphaRouter({
      chainId: this.chainId,
      provider: this.provider,
    });
    this.swapContractAddress = params.swapContractAddress;
  }

  // --- PUBLIC API - GETTERS --- //

  async getNativeCoinTransactions(walletAddress: string, fromBlock: number): Promise<EvmCoinHistoryEntry[]> {
    const categories = this.alchemyService.getNativeCoinCategories(this.chainId);

    return this.getHistory(walletAddress, fromBlock, categories);
  }

  async getERC20Transactions(walletAddress: string, fromBlock: number): Promise<EvmTokenHistoryEntry[]> {
    const categories = this.alchemyService.getERC20Categories(this.chainId);

    return this.getHistory(walletAddress, fromBlock, categories);
  }

  async getNativeCoinBalance(): Promise<number> {
    const balance = await this.alchemyService.getNativeCoinBalance(this.chainId, this.dfxAddress);

    return EvmUtil.fromWeiAmount(balance);
  }

  async getTokenBalance(asset: Asset): Promise<number> {
    const evmTokenBalances = await this.getTokenBalances([asset]);

    return evmTokenBalances[0]?.balance ?? 0;
  }

  async getTokenBalances(assets: Asset[]): Promise<EvmTokenBalance[]> {
    const evmTokenBalances: EvmTokenBalance[] = [];

    const tokenBalances = await this.alchemyService.getTokenBalances(this.chainId, this.dfxAddress, assets);

    for (const tokenBalance of tokenBalances) {
      const token = await this.getTokenByAddress(tokenBalance.contractAddress);
      const balance = EvmUtil.fromWeiAmount(tokenBalance.tokenBalance ?? 0, token.decimals);

      evmTokenBalances.push({ contractAddress: tokenBalance.contractAddress, balance: balance });
    }

    return evmTokenBalances;
  }

  async getRecommendedGasPrice(): Promise<EthersNumber> {
    // 10% cap
    return this.provider.getGasPrice().then((p) => p.mul(11).div(10));
  }

  async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getTokenGasLimitForAsset(token: Asset): Promise<EthersNumber> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.getTokenGasLimitForContact(contract);
  }

  async getTokenGasLimitForContact(contract: Contract): Promise<EthersNumber> {
    return contract.estimateGas.transfer(this.randomReceiverAddress, 1).then((l) => l.mul(12).div(10));
  }

  // --- PUBLIC API - WRITE TRANSACTIONS --- //

  async sendRawTransactionFromAccount(
    account: WalletAccount,
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    return this.sendRawTransaction(wallet, request);
  }

  async sendRawTransactionFromDex(
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    return this.sendRawTransaction(this.wallet, request);
  }

  async sendRawTransaction(
    wallet: ethers.Wallet,
    request: ethers.providers.TransactionRequest,
  ): Promise<ethers.providers.TransactionResponse> {
    let { nonce, gasPrice, value } = request;

    nonce = nonce ?? (await this.getNonce(request.from));
    gasPrice = gasPrice ?? +(await this.getRecommendedGasPrice());
    value = EvmUtil.toWeiAmount(value as number);

    return wallet.sendTransaction({
      ...request,
      nonce,
      gasPrice,
      value,
    });
  }

  async sendNativeCoinFromAccount(
    account: WalletAccount,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    return this.sendNativeCoin(wallet, toAddress, amount, feeLimit);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number, feeLimit?: number, nonce?: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount, feeLimit, nonce);
  }

  async sendTokenFromAccount(
    account: WalletAccount,
    toAddress: string,
    token: Asset,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const wallet = EvmUtil.createWallet(account, this.provider);

    const contract = new ethers.Contract(token.chainId, ERC20_ABI, wallet);

    return this.sendToken(contract, wallet.address, toAddress, amount, feeLimit);
  }

  async sendTokenFromDex(
    toAddress: string,
    token: Asset,
    amount: number,
    feeLimit?: number,
    nonce?: number,
  ): Promise<string> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.sendToken(contract, this.dfxAddress, toAddress, amount, feeLimit, nonce);
  }

  // --- PUBLIC API - UTILITY --- //

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTxReceipt(txHash);

    return transaction && transaction.confirmations > 0 && transaction.status === 1;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.provider.getTransaction(txHash);
  }

  async getTxReceipt(txHash: string): Promise<ethers.providers.TransactionReceipt> {
    return this.provider.getTransactionReceipt(txHash);
  }

  async getTxNonce(txHash: string): Promise<number> {
    return this.provider.getTransaction(txHash).then((r) => r?.nonce);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice } = await this.getTxReceipt(txHash);
    const actualFee = gasUsed.mul(effectiveGasPrice);

    return EvmUtil.fromWeiAmount(actualFee);
  }

  async approveContract(asset: Asset, contractAddress: string): Promise<string> {
    const contract = this.getERC20ContractForDex(asset.chainId);

    const transaction = await contract.populateTransaction.approve(contractAddress, ethers.constants.MaxInt256);

    const tx = await this.wallet.sendTransaction({
      ...transaction,
      from: this.dfxAddress,
    });

    return tx.hash;
  }

  // --- PUBLIC API - SWAPS --- //
  async testSwap(
    source: Asset,
    sourceAmount: number,
    target: Asset,
    maxSlippage: number,
  ): Promise<{ targetAmount: number; feeAmount: number }> {
    if (source.id === target.id) return { targetAmount: sourceAmount, feeAmount: 0 };

    const route = await this.getRoute(source, target, sourceAmount, maxSlippage);

    return {
      targetAmount: +route.quote.toExact(),
      feeAmount: EvmUtil.fromWeiAmount(route.estimatedGasUsed.mul(route.gasPriceWei)),
    };
  }

  async swap(sourceToken: Asset, sourceAmount: number, targetToken: Asset, maxSlippage: number): Promise<string> {
    const route = await this.getRoute(sourceToken, targetToken, sourceAmount, maxSlippage);

    const tx = await this.wallet.sendTransaction({
      data: route.methodParameters?.calldata,
      to: this.swapContractAddress,
      value: route.methodParameters?.value,
      from: this.dfxAddress,
    });

    return tx.hash;
  }

  private async getRoute(source: Asset, target: Asset, sourceAmount: number, maxSlippage: number): Promise<SwapRoute> {
    const sourceToken = await this.getToken(source);
    const targetToken = await this.getToken(target);

    const route = await this.router.route(
      this.toCurrencyAmount(sourceAmount, sourceToken),
      targetToken,
      TradeType.EXACT_INPUT,
      this.swapConfig(maxSlippage),
    );

    if (!route)
      throw new Error(
        `No swap route found for ${sourceAmount} ${source.name} -> ${target.name} (${source.blockchain})`,
      );

    return route;
  }

  // --- GETTERS --- //
  get dfxAddress(): string {
    return this.wallet.address;
  }

  swapConfig(maxSlippage: number) {
    return {
      recipient: this.dfxAddress,
      slippageTolerance: new Percent(maxSlippage * 1000, 1000),
      deadline: Math.floor(Util.minutesAfter(30).getTime() / 1000),
      type: SwapType.SWAP_ROUTER_02,
    };
  }

  // --- PUBLIC HELPER METHODS --- //

  async getToken(asset: Asset): Promise<Currency> {
    return asset.type === AssetType.COIN ? Ether.onChain(this.chainId) : this.getTokenByAddress(asset.chainId);
  }

  // --- PRIVATE HELPER METHODS --- //

  private toCurrencyAmount(amount: number, token: Currency): CurrencyAmount<Currency> {
    const targetAmount = EvmUtil.toWeiAmount(amount, token.decimals).toString();

    return CurrencyAmount.fromRawAmount(token, targetAmount);
  }

  private async getTokenByAddress(address: string): Promise<Token> {
    const contract = this.getERC20ContractForDex(address);
    return this.getTokenByContract(contract);
  }

  protected getERC20ContractForDex(tokenAddress: string): Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
  }

  protected async getTokenByContract(contract: Contract): Promise<Token> {
    return this.tokens.get(
      contract.address,
      async () => new Token(this.chainId, contract.address, await contract.decimals()),
    );
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGas = await this.getCurrentGasForCoinTransaction(this.dfxAddress, 1e-18);
    const gasPrice = await this.getRecommendedGasPrice();

    return EvmUtil.fromWeiAmount(totalGas.mul(gasPrice));
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGas = await this.getTokenGasLimitForAsset(token);
    const gasPrice = await this.getRecommendedGasPrice();

    return EvmUtil.fromWeiAmount(totalGas.mul(gasPrice));
  }

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    toAddress: string,
    amount: number,
    feeLimit?: number,
    nonce?: number,
  ): Promise<string> {
    const fromAddress = wallet.address;

    const gasLimit = await this.getCurrentGasForCoinTransaction(fromAddress, amount);
    const gasPrice = await this.getGasPrice(+gasLimit, feeLimit);
    const currentNonce = await this.getNonce(fromAddress);
    const txNonce = nonce ?? currentNonce;

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: EvmUtil.toWeiAmount(amount),
      nonce: txNonce,
      gasPrice,
      gasLimit,
    });

    if (txNonce >= currentNonce) this.nonce.set(fromAddress, txNonce + 1);

    return tx.hash;
  }

  protected async getCurrentGasForCoinTransaction(fromAddress: string, amount: number): Promise<EthersNumber> {
    return this.provider.estimateGas({
      from: fromAddress,
      to: this.randomReceiverAddress,
      value: EvmUtil.toWeiAmount(amount),
    });
  }

  private async sendToken(
    contract: Contract,
    fromAddress: string,
    toAddress: string,
    amount: number,
    feeLimit?: number,
    nonce?: number,
  ): Promise<string> {
    const gasLimit = +(await this.getTokenGasLimitForContact(contract));
    const gasPrice = await this.getGasPrice(gasLimit, feeLimit);
    const currentNonce = await this.getNonce(fromAddress);
    const txNonce = nonce ?? currentNonce;

    const token = await this.getTokenByContract(contract);
    const targetAmount = EvmUtil.toWeiAmount(amount, token.decimals);

    const tx = await contract.transfer(toAddress, targetAmount, { gasPrice, gasLimit, nonce: txNonce });

    if (txNonce >= currentNonce) this.nonce.set(fromAddress, txNonce + 1);

    return tx.hash;
  }

  protected async getGasPrice(gasLimit: number, feeLimit?: number): Promise<number> {
    const currentGasPrice = +(await this.getRecommendedGasPrice());
    const proposedGasPrice = feeLimit != null ? Util.round(+EvmUtil.toWeiAmount(feeLimit) / gasLimit, 0) : Infinity;

    return Math.min(currentGasPrice, proposedGasPrice);
  }

  protected async getNonce(address: string): Promise<number> {
    const blockchainNonce = await this.provider.getTransactionCount(address);
    const cachedNonce = this.nonce.get(address) ?? 0;

    return Math.max(blockchainNonce, cachedNonce);
  }

  private async getHistory<T>(
    walletAddress: string,
    fromBlock: number,
    categories: AssetTransfersCategory[],
  ): Promise<T[]> {
    const params: AssetTransfersParams = {
      fromAddress: walletAddress,
      toAddress: undefined,
      fromBlock: fromBlock,
      categories: categories,
    };

    const assetTransferResult = await this.alchemyService.getAssetTransfers(this.chainId, params);

    params.fromAddress = undefined;
    params.toAddress = walletAddress;

    assetTransferResult.push(...(await this.alchemyService.getAssetTransfers(this.chainId, params)));

    assetTransferResult.sort((atr1, atr2) => Number(atr1.blockNum) - Number(atr2.blockNum));

    return <T[]>assetTransferResult.map((atr) => ({
      blockNumber: Number(atr.blockNum).toString(),
      timeStamp: Number(new Date(atr.metadata.blockTimestamp).getTime() / 1000).toString(),
      hash: atr.hash,
      from: atr.from,
      to: atr.to,
      value: Number(atr.rawContract.value).toString(),
      contractAddress: atr.rawContract.address ?? '',
      tokenName: atr.asset,
      tokenDecimal: Number(atr.rawContract.decimal).toString(),
    }));
  }
}
