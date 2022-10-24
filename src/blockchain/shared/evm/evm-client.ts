import { BigNumber, Contract, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import * as ERC20_ABI from './abi/erc20.abi.json';
import * as UNISWAP_ROUTER_02_ABI from './abi/uniswap-router02.abi.json';

export class EvmClient {
  #dfxAddress: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;
  #router: Contract;
  #erc20Tokens: Map<string, Contract> = new Map();
  #swapTokenAddress: string;

  #sendCoinGasLimit = 21000;

  constructor(
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

  async getNativeCoinBalance(): Promise<number> {
    const balance = await this.#provider.getBalance(this.#dfxAddress);

    return this.convertToEthLikeDenomination(balance);
  }

  async getTokenBalance(token: Asset): Promise<number> {
    const contract = this.getERC20Contract(token.chainId);
    const balance = await contract.balanceOf(this.#dfxAddress);
    const decimals = await contract.decimals();

    return this.convertToEthLikeDenomination(balance, decimals);
  }

  async getGasPrice(): Promise<BigNumber> {
    return this.#provider.getGasPrice();
  }

  async getTokenGasLimit(token: Asset): Promise<BigNumber> {
    const contract = this.getERC20Contract(token.chainId);

    return contract.estimateGas.transfer(this.#dfxAddress, 1);
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    const gasPrice = await this.getGasPrice();

    const tx = await this.#wallet.sendTransaction({
      from: this.#dfxAddress,
      to: address,
      value: this.convertToWeiLikeDenomination(amount, 'ether'),
      gasPrice,
      // has to be provided as a number for BSC
      gasLimit: this.#sendCoinGasLimit,
    });

    return tx.hash;
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    const contract = this.getERC20Contract(token.chainId);
    const decimals = await contract.decimals();
    const targetAmount = this.convertToWeiLikeDenomination(amount, decimals);

    const tx = await contract.transfer(address, targetAmount);

    return tx.hash;
  }

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTx(txHash);

    return transaction && transaction.confirmations > 0;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.#provider.getTransaction(txHash);
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

  convertToEthLikeDenomination(amountWeiLike: BigNumber, decimals?: number | 'gwei'): number {
    return decimals
      ? parseFloat(ethers.utils.formatUnits(amountWeiLike, decimals))
      : parseFloat(ethers.utils.formatEther(amountWeiLike));
  }

  //*** PRIVATE HELPER METHODS ***//

  private getERC20Contract(tokenAddress: string): Contract {
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
