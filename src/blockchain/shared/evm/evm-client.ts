import { ethers } from 'ethers';

export class EVMClient {
  #address: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;

  constructor(gatewayUrl: string, privateKey: string, address: string) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#address = address;
  }

  async getBalance(): Promise<number> {
    const balance = await this.#provider.getBalance(this.#address);

    return parseFloat(ethers.utils.formatEther(balance));
  }

  async send(address: string, amount: number): Promise<string> {
    const nonce = await this.#wallet.getTransactionCount();
    const gasPrice = await this.#provider.getGasPrice();

    const tx = await this.#wallet.sendTransaction({
      from: this.#address,
      to: address,
      value: ethers.utils.parseUnits(`${amount}`, 'ether'),
      nonce,
      gasPrice,
      gasLimit: '21000',
    });

    await tx.wait();

    return tx.hash;
  }

  async isTxComplete(txHash: string): Promise<boolean> {
    const transaction = await this.getTx(txHash);

    return transaction && transaction.confirmations > 0;
  }

  async getTx(txHash: string): Promise<ethers.providers.TransactionResponse> {
    return this.#provider.getTransaction(txHash);
  }
}
