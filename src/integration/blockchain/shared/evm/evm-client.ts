import { BigNumber, Contract, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import ERC20_ABI from './abi/erc20.abi.json';
import UNISWAP_ROUTER_02_ABI from './abi/uniswap-router02.abi.json';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';
import { WalletAccount } from './domain/wallet-account';
import { EvmUtil } from './evm.util';

export abstract class EvmClient {
  protected provider: ethers.providers.JsonRpcProvider;
  protected randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';
  protected wallet: ethers.Wallet;
  protected nonce = new Map<string, number>();

  #router: Contract;
  #erc20Tokens: Map<string, Contract> = new Map();
  #swapTokenAddress: string;

  #sendCoinGasLimit = 21000;

  constructor(
    protected http: HttpService,
    protected scanApiUrl: string,
    protected scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.#swapTokenAddress = swapTokenAddress;
    this.#router = new ethers.Contract(swapContractAddress, UNISWAP_ROUTER_02_ABI, this.wallet);
  }

  //*** PUBLIC API - GETTERS ***//

  async getNativeCoinTransactions(walletAddress: string, fromBlock: number): Promise<EvmCoinHistoryEntry[]> {
    const params = {
      ...this.getTransactionHistoryCommonParams(walletAddress, fromBlock),
      action: 'txlist',
    };

    return this.http.get<{ result: EvmCoinHistoryEntry[] }>(this.scanApiUrl, { params }).then((r) => r.result);
  }

  async getERC20Transactions(walletAddress: string, fromBlock: number): Promise<EvmTokenHistoryEntry[]> {
    const params = {
      ...this.getTransactionHistoryCommonParams(walletAddress, fromBlock),
      action: 'tokentx',
    };

    return this.http.get<{ result: EvmTokenHistoryEntry[] }>(this.scanApiUrl, { params }).then((r) => r.result);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getNativeCoinBalanceOfAddress(this.dfxAddress);
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.getTokenBalanceOfAddress(this.dfxAddress, token);
  }

  async getNativeCoinBalanceOfAddress(address: string): Promise<number> {
    const balance = await this.provider.getBalance(address);

    return this.convertToEthLikeDenomination(balance);
  }

  async getTokenBalanceOfAddress(address: string, token: Asset): Promise<number> {
    const contract = this.getERC20ContractForDex(token.chainId);
    const balance = await contract.balanceOf(address);
    const decimals = await contract.decimals();

    return this.convertToEthLikeDenomination(balance, decimals);
  }

  async getCurrentGasPrice(): Promise<BigNumber> {
    return this.provider.getGasPrice();
  }

  async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getTokenGasLimitForAsset(token: Asset): Promise<BigNumber> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.getTokenGasLimitForContact(contract);
  }

  async getTokenGasLimitForContact(contract: Contract): Promise<BigNumber> {
    return contract.estimateGas.transfer(this.randomReceiverAddress, 1);
  }

  //*** PUBLIC API - WRITE TRANSACTIONS ***//

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
    value = this.convertToWeiLikeDenomination(value as number, 'ether');

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

  //*** PUBLIC API - UTILITY ***//

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

    return this.convertToEthLikeDenomination(actualFee);
  }

  async nativeCryptoTestSwap(nativeCryptoAmount: number, targetToken: Asset): Promise<number> {
    const contract = new ethers.Contract(targetToken.chainId, ERC20_ABI, this.wallet);
    const inputAmount = this.convertToWeiLikeDenomination(nativeCryptoAmount, 'ether');
    const outputAmounts = await this.#router.getAmountsOut(inputAmount, [this.#swapTokenAddress, targetToken.chainId]);
    const decimals = await contract.decimals();

    return this.convertToEthLikeDenomination(outputAmounts[1], decimals);
  }

  async tokenTestSwap(sourceToken: Asset, sourceAmount: number, targetToken: Asset): Promise<number> {
    const sourceContract = new ethers.Contract(sourceToken.chainId, ERC20_ABI, this.wallet);
    const sourceTokenDecimals = await sourceContract.decimals();

    const targetContract = new ethers.Contract(targetToken.chainId, ERC20_ABI, this.wallet);
    const targetTokenDecimals = await targetContract.decimals();

    const inputAmount = this.convertToWeiLikeDenomination(sourceAmount, sourceTokenDecimals);
    const outputAmounts = await this.#router.getAmountsOut(inputAmount, [
      sourceToken.chainId,
      this.#swapTokenAddress,
      targetToken.chainId,
    ]);

    return this.convertToEthLikeDenomination(outputAmounts[2], targetTokenDecimals);
  }

  //*** GETTERS ***//

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

  //*** PUBLIC HELPER METHODS ***//

  convertToEthLikeDenomination(amountWeiLike: BigNumber, decimals?: number): number {
    return decimals
      ? parseFloat(ethers.utils.formatUnits(amountWeiLike, decimals))
      : parseFloat(ethers.utils.formatEther(amountWeiLike));
  }

  convertToWeiLikeDenomination(amountEthLike: number, decimals: number | 'ether'): BigNumber {
    const amount = decimals === 'ether' ? amountEthLike.toFixed(16) : amountEthLike.toFixed(decimals);

    return ethers.utils.parseUnits(amount, decimals);
  }

  getERC20ContractForDex(tokenAddress: string): Contract {
    let tokenContract = this.#erc20Tokens.get(tokenAddress);

    if (!tokenContract) {
      tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      this.#erc20Tokens.set(tokenAddress, tokenContract);
    }

    return tokenContract;
  }

  //*** PRIVATE HELPER METHODS ***//

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
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
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
    const targetAmount = this.convertToWeiLikeDenomination(amount, decimals);

    const tx = await contract.transfer(toAddress, targetAmount, { gasPrice, gasLimit: effectiveGasLimit, nonce });

    this.nonce.set(fromAddress, nonce + 1);

    return tx.hash;
  }

  protected async getGasPrice(gasLimit: number, feeLimit?: number): Promise<number> {
    const currentGasPrice = +(await this.getCurrentGasPrice());
    const proposedGasPrice =
      feeLimit != null ? Util.round(+this.convertToWeiLikeDenomination(feeLimit, 'ether') / gasLimit, 0) : null;

    if (!proposedGasPrice) return currentGasPrice;

    return currentGasPrice < proposedGasPrice ? currentGasPrice : proposedGasPrice;
  }

  protected async getNonce(address: string): Promise<number> {
    const blockchainNonce = await this.provider.getTransactionCount(address);
    const cachedNonce = this.nonce.get(address) ?? 0;

    const currentNonce = blockchainNonce > cachedNonce ? blockchainNonce : cachedNonce;

    return currentNonce;
  }

  private getTransactionHistoryCommonParams(walletAddress: string, fromBlock: number) {
    return {
      module: 'account',
      address: walletAddress,
      startblock: fromBlock,
      apikey: this.scanApiKey,
      sort: 'asc',
    };
  }
}
