import { CurrencyAmount, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, ChainId, SwapType } from '@uniswap/smart-order-router';
import BigNumber from 'bignumber.js';
import { BigNumberish, Contract, BigNumber as EthersNumber, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from './abi/erc20.abi.json';
import { WalletAccount } from './domain/wallet-account';
import { ScanApiResponse } from './dto/scan-api-response.dto';
import { EvmUtil } from './evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

export abstract class EvmClient {
  protected provider: ethers.providers.JsonRpcProvider;
  protected randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';
  protected wallet: ethers.Wallet;
  protected nonce = new Map<string, number>();
  protected tokens = new AsyncCache<Token>();
  private router: AlphaRouter;

  #sendCoinGasLimit = 21000;

  constructor(
    protected http: HttpService,
    protected scanApiUrl: string,
    protected scanApiKey: string,
    protected chainId: ChainId,
    gatewayUrl: string,
    privateKey: string,
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    this.router = new AlphaRouter({
      chainId: this.chainId,
      provider: this.provider,
    });
  }

  // --- PUBLIC API - GETTERS --- //

  async getNativeCoinTransactions(walletAddress: string, fromBlock: number): Promise<EvmCoinHistoryEntry[]> {
    return this.getHistory(walletAddress, fromBlock, 'txlist');
  }

  async getERC20Transactions(walletAddress: string, fromBlock: number): Promise<EvmTokenHistoryEntry[]> {
    return this.getHistory(walletAddress, fromBlock, 'tokentx');
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceOfAddress(this.dfxAddress);
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.getTokenBalanceOfAddress(this.dfxAddress, token);
  }

  async getNativeCoinBalanceOfAddress(address: string): Promise<number> {
    const balance = await this.provider.getBalance(address);

    return this.fromWeiAmount(balance);
  }

  async getTokenBalanceOfAddress(address: string, token: Asset): Promise<number> {
    const contract = this.getERC20ContractForDex(token.chainId);
    const balance = await contract.balanceOf(address);
    const decimals = await contract.decimals();

    return this.fromWeiAmount(balance, decimals);
  }

  async getCurrentGasPrice(): Promise<EthersNumber> {
    return this.provider.getGasPrice();
  }

  async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getTokenGasLimitForAsset(token: Asset): Promise<EthersNumber> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.getTokenGasLimitForContact(contract);
  }

  async getTokenGasLimitForContact(contract: Contract): Promise<EthersNumber> {
    return contract.estimateGas.transfer(this.randomReceiverAddress, 1);
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
    gasPrice = gasPrice ?? +(await this.getCurrentGasPrice());
    value = this.toWeiAmount(value as number);

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

  async sendNativeCoinFromDex(toAddress: string, amount: number, feeLimit?: number): Promise<string> {
    return this.sendNativeCoin(this.wallet, toAddress, amount, feeLimit);
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

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number, feeLimit?: number): Promise<string> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.sendToken(contract, this.dfxAddress, toAddress, amount, feeLimit);
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

  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice } = await this.getTxReceipt(txHash);
    const actualFee = gasUsed.mul(effectiveGasPrice);

    return this.fromWeiAmount(actualFee);
  }

  async testSwap(sourceToken: Asset, sourceAmount: number, targetToken: Asset): Promise<number> {
    const source = await this.getToken(sourceToken.chainId);
    const target = await this.getToken(targetToken.chainId);

    const route = await this.router.route(
      this.toCurrencyAmount(sourceAmount, source),
      target,
      TradeType.EXACT_INPUT,
      this.swapConfig,
    );

    if (!route)
      throw new Error(
        `No swap route found for ${sourceAmount} ${sourceToken.name} -> ${targetToken.name} (${sourceToken.blockchain})`,
      );

    return +route.quote.toExact();
  }

  // --- GETTERS --- //

  get sendCoinGasLimit(): number {
    return this.#sendCoinGasLimit;
  }

  get dummyTokenPayload(): string {
    const method = 'a9059cbb000000000000000000000000';
    const destination = this.randomReceiverAddress.slice(2);
    const value = '0000000000000000000000000000000000000000000000000000000000000001';

    return '0x' + method + destination + value;
  }

  get dfxAddress(): string {
    return this.wallet.address;
  }

  get swapConfig() {
    return {
      recipient: this.dfxAddress,
      slippageTolerance: new Percent(20, 100),
      deadline: Math.floor(Date.now() / 1000 + 1800),
      type: SwapType.SWAP_ROUTER_02,
    };
  }

  // --- PUBLIC HELPER METHODS --- //

  fromWeiAmount(amountWeiLike: BigNumberish, decimals?: number): number {
    const amount = decimals
      ? ethers.utils.formatUnits(amountWeiLike, decimals)
      : ethers.utils.formatEther(amountWeiLike);

    return parseFloat(amount);
  }

  toWeiAmount(amountEthLike: number, decimals?: number): EthersNumber {
    const amount = new BigNumber(amountEthLike).toFixed(decimals ?? 16);

    return decimals ? ethers.utils.parseUnits(amount, decimals) : ethers.utils.parseEther(amount);
  }

  private toCurrencyAmount(amount: number, token: Token): CurrencyAmount<Token> {
    const targetAmount = this.toWeiAmount(amount, token.decimals).toString();

    return CurrencyAmount.fromRawAmount(token, targetAmount);
  }

  getERC20ContractForDex(tokenAddress: string): Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
  }

  async getToken(tokenAddress: string): Promise<Token> {
    return this.tokens.get(tokenAddress, async () => {
      const contract = this.getERC20ContractForDex(tokenAddress);
      return new Token(this.chainId, contract.address, await contract.decimals());
    });
  }

  // --- PRIVATE HELPER METHODS --- //

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const fromAddress = wallet.address;
    const gasPrice = await this.getGasPrice(this.#sendCoinGasLimit, feeLimit);
    const nonce = await this.getNonce(fromAddress);

    const tx = await wallet.sendTransaction({
      from: wallet.address,
      to: toAddress,
      value: this.toWeiAmount(amount),
      nonce,
      gasPrice,
      // has to be provided as a number for BSC
      gasLimit: this.#sendCoinGasLimit,
    });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  private async sendToken(
    contract: Contract,
    fromAddress: string,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    /**
     * @note
     * adding a cap to make sure gas limit is sufficient
     */
    const gasLimit = +(await this.getTokenGasLimitForContact(contract));
    const gasPrice = await this.getGasPrice(gasLimit, feeLimit);
    const nonce = await this.getNonce(fromAddress);

    const effectiveGasLimit = Util.round(gasLimit * 1.5, 0);

    const decimals = await contract.decimals();
    const targetAmount = this.toWeiAmount(amount, decimals);

    const tx = await contract.transfer(toAddress, targetAmount, { gasPrice, gasLimit: effectiveGasLimit, nonce });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  protected async getGasPrice(gasLimit: number, feeLimit?: number): Promise<number> {
    const currentGasPrice = +(await this.getCurrentGasPrice());
    const proposedGasPrice = feeLimit != null ? Util.round(+this.toWeiAmount(feeLimit) / gasLimit, 0) : null;

    if (!proposedGasPrice) return currentGasPrice;

    return currentGasPrice < proposedGasPrice ? currentGasPrice : proposedGasPrice;
  }

  protected async getNonce(address: string): Promise<number> {
    const blockchainNonce = await this.provider.getTransactionCount(address);
    const cachedNonce = this.nonce.get(address) ?? 0;

    const currentNonce = blockchainNonce > cachedNonce ? blockchainNonce : cachedNonce;

    return currentNonce;
  }

  private async getHistory<T>(walletAddress: string, fromBlock: number, type: string): Promise<T[]> {
    const params = {
      module: 'account',
      address: walletAddress,
      startblock: fromBlock,
      apikey: this.scanApiKey,
      sort: 'asc',
      action: type,
    };

    const { result, message } = await this.http.get<ScanApiResponse<T[]>>(this.scanApiUrl, { params });

    if (!Array.isArray(result)) throw new Error(`Failed to get ${type} transactions: ${result ?? message}`);

    return result;
  }
}
