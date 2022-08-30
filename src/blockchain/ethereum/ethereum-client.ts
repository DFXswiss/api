import { ethers } from 'ethers';

export enum EthereumDenomination {
  ETH = 'ETH',
  WEI = 'WEI',
}

export class EthereumClient {
  #address: string;
  #provider: ethers.providers.JsonRpcProvider;
  #wallet: ethers.Wallet;

  constructor(gatewayUrl: string, privateKey: string, address: string) {
    this.#provider = new ethers.providers.JsonRpcProvider(gatewayUrl);
    this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    this.#address = address;
  }

  async getBalance(denomination = EthereumDenomination.ETH): Promise<number> {
    const wei = await this.#provider.getBalance(this.#address);

    if (denomination === EthereumDenomination.WEI) return +wei;

    return parseFloat(ethers.utils.formatEther(wei));
  }

  async send(address: string, amount: number, denomination = EthereumDenomination.ETH): Promise<string> {
    const sendAmount =
      denomination === EthereumDenomination.ETH
        ? ethers.utils.parseEther(`${amount}`)
        : ethers.utils.formatEther(amount);

    const tx = await this.#wallet.sendTransaction({
      from: this.#address,
      to: address,
      value: sendAmount,
    });

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
