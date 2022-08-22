export enum EthereumDenomination {
  ETH = 'ETH',
  WEI = 'WEI',
}

export class EthereumClient {
  // constructor() {}

  async getBalance(denomination = EthereumDenomination.ETH): Promise<number> {
    return 10;
  }

  async send(address: string, amount: number, denomination = EthereumDenomination.ETH): Promise<string> {
    return 'xyz';
  }
}
