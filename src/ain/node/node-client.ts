import { ApiClient, BigNumber } from '@defichain/jellyfish-api-core';
import { Block, BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
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
  SEND = 'send',
}

export enum NodeMode {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

export class NodeClient {
  protected chain = Config.network;
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

  async getBlock(hash: string): Promise<Block<string>> {
    return this.callNode((c) => c.blockchain.getBlock(hash, 1));
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

  async getTx(txId: string): Promise<InWalletTransaction> {
    return this.callNode((c) => c.wallet.getTransaction(txId));
  }

  // UTXO
  async getUtxo(): Promise<UTXO[]> {
    return this.callNode((c) => c.wallet.listUnspent());
  }

  async getBalance(): Promise<BigNumber> {
    return this.callNode((c) => c.wallet.getBalance());
  }

  async sendUtxoToMany(payload: { addressTo: string; amount: number }[]): Promise<string> {
    if (payload.length > 100) {
      throw new Error('Too many addresses in one transaction batch, allowed max 100 for UTXO');
    }

    const batch = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: `${p.amount}` }), {});

    return this.callNode((c) => c.wallet.sendMany(batch), true);
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
  protected async callNode<T>(call: (client: ApiClient) => Promise<T>, unlock = false): Promise<T> {
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
      client.call(NodeCommand.UNLOCK, [Config.blockchain.default.walletPassword, timeout], 'number'),
    );
  }

  private call<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    return this.queue.handle(() => call(this.client));
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(
      `${Config.blockchain.default.user}:${Config.blockchain.default.password}`,
    ).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }

  protected roundAmount(amount: number): number {
    return Util.round(amount, 8);
  }

  get mode(): NodeMode {
    return this.#mode;
  }
}
