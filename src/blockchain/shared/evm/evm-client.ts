import { Contract, ethers } from 'ethers';
import { Asset } from 'src/shared/models/asset/asset.entity';
import ERC20ABI from './abi/erc20.abi.json';

export class EvmClient {
  #address: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;
  #erc20Tokens: Map<string, Contract>;

  constructor(gatewayUrl: string, privateKey: string, address: string) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#address = address;
  }

  async getNativeCryptoBalance(): Promise<number> {
    const balance = await this.#provider.getBalance(this.#address);

    return parseFloat(ethers.utils.formatEther(balance));
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.getERC20Contract(token.chainId).balanceOf(this.#address);
  }

  async sendNativeCrypto(address: string, amount: number): Promise<string> {
    const gasPrice = await this.#provider.getGasPrice();

    const tx = await this.#wallet.sendTransaction({
      from: this.#address,
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

  //*** HELPER METHODS ***//

  private getERC20Contract(tokenAddress: string): Contract {
    let token = this.#erc20Tokens.get(tokenAddress);

    if (!token) {
      token = new ethers.Contract(tokenAddress, ERC20ABI, this.#wallet);
      this.#erc20Tokens.set(tokenAddress, token);
    }

    return token;
  }
}
