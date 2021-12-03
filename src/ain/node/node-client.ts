import { ApiClient } from '@defichain/jellyfish-api-core';
import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
  SEND_UTXO = 'sendutxosfrom',
}

enum Chain {
  TEST = 'test',
  MAIN = 'main',
}

export class NodeClient {
  private chain: Chain = Chain.MAIN;
  private readonly client: ApiClient;

  constructor(private readonly http: HttpService, private readonly url: string) {
    this.client = this.createJellyfishClient();
    this.getChain().then((c) => (this.chain = c));
  }

  // common
  async getInfo(): Promise<BlockchainInfo> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo());
  }

  async getHistory(address: string, fromBlock: number, toBlock: number): Promise<AccountHistory[]> {
    return this.callNode((c) =>
      c.account.listAccountHistory(address, {
        depth: toBlock - fromBlock,
        maxBlockHeight: toBlock,
      }),
    );
  }

  // UTXO
  async getUtxo(): Promise<UTXO[]> {
    return this.callNode((c) => c.wallet.listUnspent());
  }

  async sendUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) => c.call(NodeCommand.SEND_UTXO, [addressFrom, addressTo, amount - this.utxoFee], 'number'),
      true,
    );
  }

  // token
  async testPoolSwap(address: string, tokenFrom: string, tokenTo: string, amount: number): Promise<string> {
    // TODO: use custom address
    return this.callNode((c) =>
      c.poolpair.testPoolSwap({
        from: address,
        tokenFrom: tokenFrom,
        amountFrom: amount,
        to: address,
        tokenTo: tokenTo,
      }),
    );
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
  async call<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    return this.callNode<T>(call);
  }

  // --- HELPER METHODS --- //
  private async callNode<T>(call: (client: ApiClient) => Promise<T>, unlock = false): Promise<T> {
    try {
      if (unlock) await this.unlock();
      return await call(this.client);
    } catch (e) {
      // TODO: retries?
      console.log('Exception during node call:', e);
      throw new ServiceUnavailableException(e);
    }
  }

  private async unlock(timeout = 10): Promise<any> {
    return this.client.call(NodeCommand.UNLOCK, [process.env.NODE_WALLET_PASSWORD, timeout], 'number');
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${process.env.NODE_USER}:${process.env.NODE_PASSWORD}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }

  private async getChain(): Promise<Chain> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo()).then((i) => i.chain as Chain);
  }

  private get utxoFee(): number {
    return this.chain === Chain.MAIN ? 0.00000132 : 0.0000222;
  }
}
