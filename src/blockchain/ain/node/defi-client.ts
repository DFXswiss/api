import { AccountHistory, AccountResult, UTXO as SpendUTXO } from '@defichain/jellyfish-api-core/dist/category/account';
import { SchedulerRegistry } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeCommand, NodeMode } from './node-client';

export class DeFiClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }

  // common
  async getHistories(addresses: string[], fromBlock: number, toBlock: number): Promise<AccountHistory[]> {
    let results = [];
    for (const address of addresses) {
      results = results.concat(await this.getHistory(address, fromBlock, toBlock));
    }
    return results;
  }

  private async getHistory(address: string, fromBlock: number, toBlock: number): Promise<AccountHistory[]> {
    return this.callNode((c) =>
      c.account.listAccountHistory(address, {
        depth: toBlock - fromBlock,
        maxBlockHeight: toBlock,
      }),
    );
  }

  async getNodeBalance(): Promise<{ utxo: BigNumber; token: number }> {
    return { utxo: await this.getBalance(), token: await this.getToken().then((t) => t.length) };
  }

  // UTXO
  get utxoFee(): number {
    return this.chain === 'mainnet' ? 0.00000132 : 0.0000222;
  }

  async sendUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) => c.call(NodeCommand.SEND_UTXO, [addressFrom, addressTo, this.roundAmount(amount)], 'number'),
      true,
    );
  }

  async sendCompleteUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) =>
        c.call(
          NodeCommand.SEND_UTXO,
          [addressFrom, addressTo, this.roundAmount(amount - this.utxoFee), addressTo],
          'number',
        ),
      true,
    );
  }

  // token
  async getToken(): Promise<AccountResult<string, string>[]> {
    return this.callNode((c) => c.account.listAccounts({}, false, { indexedAmounts: false, isMineOnly: true }));
  }

  async testCompositeSwap(tokenFrom: string, tokenTo: string, amount: number): Promise<number> {
    if (tokenFrom === tokenTo) return amount;

    return this.callNode((c) =>
      c.call(
        NodeCommand.TEST_POOL_SWAP,
        [
          {
            from: undefined,
            tokenFrom: tokenFrom,
            amountFrom: this.roundAmount(amount),
            to: undefined,
            tokenTo: tokenTo,
          },
          'auto',
        ],
        'number',
      ),
    ).then((r: string) => this.parseAmount(r).amount);
  }

  async compositeSwap(
    addressFrom: string,
    tokenFrom: string,
    addressTo: string,
    tokenTo: string,
    amount: number,
    utxos?: SpendUTXO[],
    maxPrice?: number,
  ): Promise<string> {
    return this.callNode(
      (c) =>
        c.poolpair.compositeSwap(
          {
            from: addressFrom,
            tokenFrom: tokenFrom,
            amountFrom: this.roundAmount(amount),
            to: addressTo,
            tokenTo: tokenTo,
            maxPrice,
          },
          utxos,
        ),
      true,
    );
  }

  async addPoolLiquidity(address: string, assetsPair: [string, string]): Promise<string> {
    return this.callNode((c) => c.poolpair.addPoolLiquidity({ [address]: assetsPair }, address), true);
  }

  async sendToken(
    addressFrom: string,
    addressTo: string,
    token: string,
    amount: number,
    utxos: SpendUTXO[] = [],
  ): Promise<string> {
    return token === 'DFI'
      ? this.toUtxo(addressFrom, addressTo, amount, utxos)
      : this.callNode(
          (c) =>
            c.account.accountToAccount(addressFrom, { [addressTo]: `${this.roundAmount(amount)}@${token}` }, { utxos }),
          true,
        );
  }

  async sendTokenToMany(
    addressFrom: string,
    token: string,
    payload: { addressTo: string; amount: number }[],
    utxos: SpendUTXO[] = [],
  ): Promise<string> {
    if (payload.length > 10) {
      throw new Error('Too many addresses in one transaction batch, allowed max 10 for tokens');
    }

    const batch = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: `${p.amount}@${token}` }), {});

    return this.callNode((c) => c.account.accountToAccount(addressFrom, batch, { utxos }), true);
  }

  async toUtxo(addressFrom: string, addressTo: string, amount: number, utxos?: SpendUTXO[]): Promise<string> {
    return this.callNode(
      (c) => c.account.accountToUtxos(addressFrom, { [addressTo]: `${this.roundAmount(amount)}@DFI` }, { utxos }),
      true,
    );
  }

  async removePoolLiquidity(address: string, amount: string, utxos?: SpendUTXO[]): Promise<string> {
    return this.callNode((c) => c.poolpair.removePoolLiquidity(address, amount, { utxos }), true);
  }
}
