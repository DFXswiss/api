import { ApiClient, BigNumber } from '@defichain/jellyfish-api-core';
import { AccountHistory, AccountResult, UTXO as SpendUTXO } from '@defichain/jellyfish-api-core/dist/category/account';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { InWalletTransaction, UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { ServiceUnavailableException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { QueueHandler } from 'src/shared/queue-handler';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
  SEND_UTXO = 'sendutxosfrom',
  TEST_POOL_SWAP = 'testpoolswap',
}

export enum NodeMode {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

export class NodeClient {
  private chain = Config.network;
  private readonly client: ApiClient;
  private readonly queue: QueueHandler;

  readonly #mode: NodeMode;

  constructor(
    private readonly http: HttpService,
    private readonly url: string,
    scheduler: SchedulerRegistry,
    mode: NodeMode,
  ) {
    this.client = this.createJellyfishClient();
    this.queue = new QueueHandler(scheduler, 65000);
    this.#mode = mode;

    this.getInfo().catch((e) => console.error('Failed to get chain info: ', e));
  }

  // common
  async getInfo(): Promise<BlockchainInfo> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo());
  }

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

  async waitForTx(txId: string, timeout = 600000): Promise<InWalletTransaction> {
    const tx = await Util.poll(
      () => this.callNode((c) => c.wallet.getTransaction(txId)),
      (t) => t?.confirmations > 0,
      5000,
      timeout,
    );

    if (!(tx?.confirmations > 0)) throw new ServiceUnavailableException('Wait for TX timed out');
    return tx;
  }

  // UTXO
  get utxoFee(): number {
    return this.chain === 'main' ? 0.00000132 : 0.0000222;
  }

  async getUtxo(): Promise<UTXO[]> {
    return this.callNode((c) => c.wallet.listUnspent());
  }

  async getBalance(): Promise<BigNumber> {
    return this.callNode((c) => c.wallet.getBalance());
  }

  async getNodeBalance(): Promise<{ utxo: BigNumber; token: AccountResult<string, string>[] }> {
    return { utxo: await this.getBalance(), token: await this.getToken() };
  }

  async sendUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
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

  async sendCompleteUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) => c.call(NodeCommand.SEND_UTXO, [addressFrom, addressTo, this.roundAmount(amount / 2), addressTo], 'number'),
      true,
    );
  }

  async sendMany(amounts: Record<string, number>): Promise<string> {
    return this.callNode((c) => c.wallet.sendMany(amounts), true);
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
          },
          utxos,
        ),
      true,
    );
  }

  async sendToken(
    addressFrom: string,
    addressTo: string,
    token: string,
    amount: number,
    utxos?: SpendUTXO[],
  ): Promise<string> {
    return token === 'DFI'
      ? this.toUtxo(addressFrom, addressTo, amount, utxos)
      : this.callNode(
          (c) =>
            c.account.accountToAccount(addressFrom, { [addressTo]: `${this.roundAmount(amount)}@${token}` }, { utxos }),
          true,
        );
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

  // forwarding
  async sendRpcCommand(command: string): Promise<any> {
    return this.http.post(this.url, command, {
      headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
    });
  }

  async sendCliCommand(command: string, noAutoUnlock?: boolean): Promise<any> {
    const cmdParts = command.split(' ');

    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    return this.callNode((c) => c.call(method, params, 'number'), !noAutoUnlock);
  }

  // generic
  parseAmount(amount: string): { amount: number; asset: string } {
    return {
      amount: +amount.split('@')[0],
      asset: amount.split('@')[1],
    };
  }

  // --- HELPER METHODS --- //
  private async callNode<T>(call: (client: ApiClient) => Promise<T>, unlock = false): Promise<T> {
    try {
      if (unlock) await this.unlock();
      return await this.call(call);
    } catch (e) {
      console.log('Exception during node call:', e);
      throw new ServiceUnavailableException(e);
    }
  }

  private async unlock(timeout = 60): Promise<any> {
    return await this.call((client: ApiClient) =>
      client.call(NodeCommand.UNLOCK, [Config.node.walletPassword, timeout], 'number'),
    );
  }

  private call<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    return this.queue.handle(() => call(this.client));
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${Config.node.user}:${Config.node.password}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }

  private roundAmount(amount: number): number {
    return Util.round(amount, 8);
  }

  get mode(): NodeMode {
    return this.#mode;
  }
}
