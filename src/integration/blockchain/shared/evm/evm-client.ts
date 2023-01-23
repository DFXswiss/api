import { BigNumber, Contract, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import * as ERC20_ABI from './abi/erc20.abi.json';
import * as UNISWAP_ROUTER_02_ABI from './abi/uniswap-router02.abi.json';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from './interfaces';

export abstract class EvmClient {
  #dfxAddress: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;
  #router: Contract;
  #erc20Tokens: Map<string, Contract> = new Map();
  #swapTokenAddress: string;

  #sendCoinGasLimit = 21000;
  #randomReceiverAddress = '0x4975f78e8903548bD33aF404B596690D47588Ff5';

  constructor(
    protected http: HttpService,
    protected scanApiUrl: string,
    protected scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#dfxAddress = dfxAddress;
    this.#swapTokenAddress = swapTokenAddress;
    this.#router = new ethers.Contract(swapContractAddress, UNISWAP_ROUTER_02_ABI, this.#wallet);
  }

  //*** PUBLIC API ***//

  getRandomWallet(): ethers.Wallet {
    return ethers.Wallet.createRandom();
  }

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
    return this.getNativeCoinBalanceOfAddress(this.#dfxAddress);
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.getTokenBalanceOfAddress(this.#dfxAddress, token);
  }

  async getNativeCoinBalanceOfAddress(address: string): Promise<number> {
    const balance = await this.#provider.getBalance(address);

    return this.convertToEthLikeDenomination(balance);
  }

  async getTokenBalanceOfAddress(address: string, token: Asset): Promise<number> {
    const contract = this.getERC20ContractForDex(token.chainId);
    const balance = await contract.balanceOf(address);
    const decimals = await contract.decimals();

    return this.convertToEthLikeDenomination(balance, decimals);
  }

  async getGasPrice(): Promise<BigNumber> {
    return this.#provider.getGasPrice();
  }

  async getTokenGasLimit(token: Asset): Promise<BigNumber> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return contract.estimateGas.transfer(this.#randomReceiverAddress, 1);
  }

  async sendNativeCoinFromAddress(
    fromAddress: string,
    privateKey: string,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    const wallet = new ethers.Wallet(privateKey, this.#provider);

    return this.sendNativeCoin(wallet, fromAddress, toAddress, amount);
  }

  async sendNativeCoinFromDexAndWait(toAddress: string, amount: number): Promise<string> {
    return this.sendNativeCoinAndWait(this.#wallet, this.#dfxAddress, toAddress, amount);
  }

  async sendTokenFromAddress(
    _: string,
    privateKey: string,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    /**
     * @note
     * source address is derived from private key, thus not used directly
     */
    const contract = this.getERC20ContractForAddress(privateKey, token.chainId);

    return this.sendToken(contract, toAddress, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    const contract = this.getERC20ContractForDex(token.chainId);

    return this.sendToken(contract, toAddress, amount);
  }

  private async sendToken(contract: Contract, toAddress: string, amount: number): Promise<string> {
    const decimals = await contract.decimals();
    const targetAmount = this.convertToWeiLikeDenomination(amount, decimals);

    const tx = await contract.transfer(toAddress, targetAmount);

    return tx.hash;
  }

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTx(txHash);

    return transaction && transaction.confirmations > 0;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.#provider.getTransaction(txHash);
  }

  async getTxReceipt(txHash: string): Promise<ethers.providers.TransactionReceipt> {
    return this.#provider.getTransactionReceipt(txHash);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    const { gasUsed, effectiveGasPrice } = await this.getTxReceipt(txHash);
    const actualFee = gasUsed.mul(effectiveGasPrice);

    return this.convertToEthLikeDenomination(actualFee);
  }

  async nativeCryptoTestSwap(nativeCryptoAmount: number, targetToken: Asset): Promise<number> {
    const contract = new ethers.Contract(targetToken.chainId, ERC20_ABI, this.#wallet);
    const inputAmount = this.convertToWeiLikeDenomination(nativeCryptoAmount, 'ether');
    const outputAmounts = await this.#router.getAmountsOut(inputAmount, [this.#swapTokenAddress, targetToken.chainId]);
    const decimals = await contract.decimals();

    return this.convertToEthLikeDenomination(outputAmounts[1], decimals);
  }

  //*** GETTERS ***//

  get sendCoinGasLimit(): number {
    return this.#sendCoinGasLimit;
  }

  //*** PUBLIC HELPER METHODS ***//

  convertToEthLikeDenomination(amountWeiLike: BigNumber, decimals?: number): number {
    return decimals
      ? parseFloat(ethers.utils.formatUnits(amountWeiLike, decimals))
      : parseFloat(ethers.utils.formatEther(amountWeiLike));
  }

  //*** PRIVATE HELPER METHODS ***//

  private async sendNativeCoin(
    wallet: ethers.Wallet,
    fromAddress: string,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    const gasPrice = await this.getGasPrice();

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
      gasPrice,
      // has to be provided as a number for BSC
      gasLimit: this.#sendCoinGasLimit,
    });

    return tx.hash;
  }

  private async sendNativeCoinAndWait(
    wallet: ethers.Wallet,
    fromAddress: string,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    const gasPrice = await this.getGasPrice();

    const tx = await wallet.sendTransaction({
      from: fromAddress,
      to: toAddress,
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
      gasPrice,
      // has to be provided as a number for BSC
      gasLimit: this.#sendCoinGasLimit,
    });

    await tx.wait();

    return tx.hash;
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

  private getERC20ContractForAddress(privateKey: string, tokenAddress: string): Contract {
    const wallet = new ethers.Wallet(privateKey, this.#provider);

    return new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  }

  private getERC20ContractForDex(tokenAddress: string): Contract {
    let tokenContract = this.#erc20Tokens.get(tokenAddress);

    if (!tokenContract) {
      tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.#wallet);
      this.#erc20Tokens.set(tokenAddress, tokenContract);
    }

    return tokenContract;
  }

  private convertToWeiLikeDenomination(amountEthLike: number, decimals: number | 'ether'): BigNumber {
    const amount = decimals === 'ether' ? amountEthLike : amountEthLike.toFixed(decimals);

    return ethers.utils.parseUnits(`${amount}`, decimals);
  }
}
