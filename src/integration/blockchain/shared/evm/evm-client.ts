import { ChainId, CurrencyAmount, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router';
import {
  Alchemy,
  BigNumber as AlchemyBigNumber,
  Network as AlchemyNetwork,
  Utils as AlchemyUtils,
  AssetTransfersCategory,
  AssetTransfersWithMetadataResponse,
  AssetTransfersWithMetadataResult,
  OwnedToken,
} from 'alchemy-sdk';
import BigNumber from 'bignumber.js';
import { BigNumberish, Contract, BigNumber as EthersNumber, ethers } from 'ethers';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from './abi/erc20.abi.json';
import { WalletAccount } from './domain/wallet-account';
import { EvmUtil } from './evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

interface AssetTransfersParams {
  fromAddress?: string;
  toAddress?: string;
  fromBlock: number;
  categories: AssetTransfersCategory[];
}

export abstract class EvmClient {
  protected provider: ethers.providers.JsonRpcProvider;
  protected randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';
  protected wallet: ethers.Wallet;
  protected nonce = new Map<string, number>();
  protected tokens = new AsyncCache<Token>();
  private router: AlphaRouter;
  private alchemy: Alchemy;

  constructor(protected http: HttpService, gatewayUrl: string, privateKey: string, protected chainId: ChainId) {
    this.provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    this.router = new AlphaRouter({
      chainId: this.chainId,
      provider: this.provider,
    });

    const alchemyNetwork = AlchemyNetworkMapper.toAlchemyNetworkByChainId(chainId);

    if (alchemyNetwork) {
      this.setupAlchemy(alchemyNetwork);
    }
  }

  private setupAlchemy(alchemyNetwork: AlchemyNetwork) {
    const alchemySettings = {
      apiKey: Config.alchemy.apiKey,
      authToken: Config.alchemy.authToken,
      network: alchemyNetwork,
    };

    this.alchemy = new Alchemy(alchemySettings);
  }

  // --- PUBLIC API - GETTERS --- //

  async getNativeCoinTransactions(walletAddress: string, fromBlock: number): Promise<EvmCoinHistoryEntry[]> {
    const category = [AlchemyNetwork.ETH_MAINNET, AlchemyNetwork.ETH_GOERLI].includes(this.alchemy.config.network)
      ? [AssetTransfersCategory.EXTERNAL, AssetTransfersCategory.INTERNAL]
      : [AssetTransfersCategory.EXTERNAL];

    return this.getHistory(walletAddress, fromBlock, category);
  }

  async getERC20Transactions(walletAddress: string, fromBlock: number): Promise<EvmTokenHistoryEntry[]> {
    return this.getHistory(walletAddress, fromBlock, [AssetTransfersCategory.ERC20]);
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

  async getTokenBalanceOfAddress(address: string, asset: Asset): Promise<number> {
    const contract = this.getERC20ContractForDex(asset.chainId);
    const balance = await contract.balanceOf(address);
    const token = await this.getToken(contract);

    return this.fromWeiAmount(balance, token.decimals);
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
    const source = await this.getTokenByAddress(sourceToken.chainId);
    const target = await this.getTokenByAddress(targetToken.chainId);

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
    const amount = new BigNumber(amountEthLike).toFixed(decimals ?? 18);

    return decimals ? ethers.utils.parseUnits(amount, decimals) : ethers.utils.parseEther(amount);
  }

  private toCurrencyAmount(amount: number, token: Token): CurrencyAmount<Token> {
    const targetAmount = this.toWeiAmount(amount, token.decimals).toString();

    return CurrencyAmount.fromRawAmount(token, targetAmount);
  }

  getERC20ContractForDex(tokenAddress: string): Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
  }

  async getTokenByAddress(address: string): Promise<Token> {
    const contract = this.getERC20ContractForDex(address);
    return this.getToken(contract);
  }

  async getToken(contract: Contract): Promise<Token> {
    return this.tokens.get(
      contract.address,
      async () => new Token(this.chainId, contract.address, await contract.decimals()),
    );
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGas = await this.getCurrentGasForCoinTransaction(this.dfxAddress, 1e-18);
    const gasPrice = await this.getRecommendedGasPrice();

    return this.fromWeiAmount(totalGas.mul(gasPrice));
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGas = await this.getTokenGasLimitForAsset(token);
    const gasPrice = await this.getRecommendedGasPrice();

    return this.fromWeiAmount(totalGas.mul(gasPrice));
  }

  // --- PRIVATE HELPER METHODS --- //

  protected async sendNativeCoin(
    wallet: ethers.Wallet,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const fromAddress = wallet.address;

    const gasLimit = await this.getCurrentGasForCoinTransaction(fromAddress, amount);
    const gasPrice = await this.getGasPrice(+gasLimit, feeLimit);
    const nonce = await this.getNonce(fromAddress);

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: this.toWeiAmount(amount),
      nonce,
      gasPrice,
      gasLimit,
    });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  protected async getCurrentGasForCoinTransaction(fromAddress: string, amount: number): Promise<EthersNumber> {
    return this.provider.estimateGas({
      from: fromAddress,
      to: this.randomReceiverAddress,
      value: this.toWeiAmount(amount),
    });
  }

  private async sendToken(
    contract: Contract,
    fromAddress: string,
    toAddress: string,
    amount: number,
    feeLimit?: number,
  ): Promise<string> {
    const gasLimit = +(await this.getTokenGasLimitForContact(contract));
    const gasPrice = await this.getGasPrice(gasLimit, feeLimit);
    const nonce = await this.getNonce(fromAddress);

    const token = await this.getToken(contract);
    const targetAmount = this.toWeiAmount(amount, token.decimals);

    const tx = await contract.transfer(toAddress, targetAmount, { gasPrice, gasLimit, nonce });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  protected async getGasPrice(gasLimit: number, feeLimit?: number): Promise<number> {
    const currentGasPrice = +(await this.getRecommendedGasPrice());
    const proposedGasPrice = feeLimit != null ? Util.round(+this.toWeiAmount(feeLimit) / gasLimit, 0) : Infinity;

    return Math.min(currentGasPrice, proposedGasPrice);
  }

  protected async getNonce(address: string): Promise<number> {
    const blockchainNonce = await this.provider.getTransactionCount(address);
    const cachedNonce = this.nonce.get(address) ?? 0;

    const currentNonce = blockchainNonce > cachedNonce ? blockchainNonce : cachedNonce;

    return currentNonce;
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

    const assetTransferResult = await this.getAssetTransfers(params);

    params.fromAddress = undefined;
    params.toAddress = walletAddress;

    assetTransferResult.push(...(await this.getAssetTransfers(params)));

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

  private async getAssetTransfers(params: AssetTransfersParams): Promise<AssetTransfersWithMetadataResult[]> {
    let assetTransfersResponse = await this.alchemyGetAssetTransfers(params);
    let pageKey = assetTransfersResponse.pageKey;

    const assetTransferResult = assetTransfersResponse.transfers;

    while (pageKey) {
      assetTransfersResponse = await this.alchemyGetAssetTransfers(params, pageKey);
      pageKey = assetTransfersResponse.pageKey;

      assetTransferResult.push(...assetTransfersResponse.transfers);
    }

    return assetTransferResult;
  }

  private async alchemyGetAssetTransfers(
    params: AssetTransfersParams,
    pageKey?: string,
  ): Promise<AssetTransfersWithMetadataResponse> {
    if (!this.alchemy) throw new Error('Alchemy not available');

    return this.alchemy.core.getAssetTransfers({
      fromBlock: AlchemyUtils.hexlify(params.fromBlock),
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      category: params.categories,
      excludeZeroValue: false,
      pageKey: pageKey,
      withMetadata: true,
    });
  }

  async getNativeCoinBalanceByAlchemy(): Promise<AlchemyBigNumber> {
    if (!this.alchemy) throw new Error('Alchemy not available');

    return this.alchemy.core.getBalance(this.dfxAddress, 'latest');
  }

  async getTokenBalancesByAlchemy(): Promise<OwnedToken[]> {
    if (!this.alchemy) throw new Error('Alchemy not available');

    let tokensForOwnerResponse = await this.alchemy.core.getTokensForOwner(this.dfxAddress);
    let pageKey = tokensForOwnerResponse.pageKey;

    const ownedTokens = tokensForOwnerResponse.tokens;

    while (pageKey) {
      tokensForOwnerResponse = await this.alchemy.core.getTokensForOwner(this.dfxAddress, { pageKey: pageKey });
      pageKey = tokensForOwnerResponse.pageKey;

      ownedTokens.push(...tokensForOwnerResponse.tokens);
    }

    return ownedTokens;
  }
}
