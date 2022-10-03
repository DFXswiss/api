import { ethers } from 'ethers';

export class EvmClient {
  #address: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;

  constructor(gatewayUrl: string, privateKey: string, address: string) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#address = address;
  }

  async getNativeCryptoBalance(): Promise<number> {
    const balance = await this.#provider.getBalance(this.#address);

    return parseFloat(ethers.utils.formatEther(balance));
  }

  async getTokenBalance(tokenName: string): Promise<number> {
    return 0;
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

  async sendToken(address: string, tokenName: string, amount: number): Promise<string> {
    return 'tx hash';
  }

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTx(txHash);

    return transaction && transaction.confirmations > 0;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.#provider.getTransaction(txHash);
  }
}
