import { Contract, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import * as ERC20_ABI from './abi/erc20.abi.json';
import * as UNISWAP_ROUTER_02_ABI from './abi/erc20.abi.json';

export class EvmClient {
  #dfxAddress: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;
  #router: Contract;
  #erc20Tokens: Map<string, Contract>;

  constructor(gatewayUrl: string, privateKey: string, dfxAddress: string, swapContractAddress: string) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#dfxAddress = dfxAddress;
    this.#router = new ethers.Contract(swapContractAddress, UNISWAP_ROUTER_02_ABI, this.#wallet);
  }

  async getNativeCryptoBalance(): Promise<number> {
    const balance = await this.#provider.getBalance(this.#dfxAddress);

    return parseFloat(ethers.utils.formatEther(balance));
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.getERC20Contract(token.chainId).balanceOf(this.#dfxAddress);
  }

  async sendNativeCrypto(address: string, amount: number): Promise<string> {
    const gasPrice = await this.#provider.getGasPrice();

    const tx = await this.#wallet.sendTransaction({
      from: this.#dfxAddress,
      to: address,
      value: ethers.utils.parseUnits(`${amount}`, 'ether'),
      gasPrice,
      // has to be provided as a number for BSC
      gasLimit: 21000,
    });

    return tx.hash;
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    const contract = this.getERC20Contract(token.chainId);

    return await contract.transfer(address, ethers.utils.parseUnits(`${amount}`, 'ether'));
  }

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTx(txHash);

    return transaction && transaction.confirmations > 0;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.#provider.getTransaction(txHash);
  }

  async nativeCryptoTestSwap(nativeCryptoAmount: number, targetToken: Asset): Promise<number> {
    const inputAmount = ethers.utils.parseUnits(`${nativeCryptoAmount}`, 'ether');
    const outputAmounts = await this.#router.getAmountsOut(inputAmount, [targetToken.chainId]);

    return +ethers.utils.parseUnits(outputAmounts[0], 'wei');
  }

  //*** HELPER METHODS ***//

  private getERC20Contract(tokenAddress: string): Contract {
    let tokenContract = this.#erc20Tokens.get(tokenAddress);

    if (!tokenContract) {
      tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.#wallet);
      this.#erc20Tokens.set(tokenAddress, tokenContract);
    }

    return tokenContract;
  }
}
