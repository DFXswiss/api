import { getKeysFromAddress } from '@zano-project/zano-utils-js';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';

export class ZanoClient {
  constructor(private readonly http: HttpService) {}

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    const { spendPublicKey } = getKeysFromAddress(address);

    return this.http
      .post<{ result: { status: string } }>(`${Config.blockchain.zano.node.url}/json_rpc`, {
        id: 0,
        jsonrpc: '2.0',
        method: 'validate_signature',
        params: {
          buff: Buffer.from(message).toString('base64'),
          pkey: spendPublicKey,
          sig: signature,
        },
      })
      .then((r) => r.result?.status === 'OK')
      .catch(() => {
        return false;
      });
  }

  //--- CURRENTY USED FOR TESTING PURPOSES ---//

  async getAddress(): Promise<any> {
    return this.http.post<any>(`${Config.blockchain.zano.rpc.url}/json_rpc`, {
      id: 0,
      jsonrpc: '2.0',
      method: 'getaddress',
      params: [],
    });
  }

  async signMessage(message: string): Promise<any> {
    return this.http.post<any>(`${Config.blockchain.zano.rpc.url}/json_rpc`, {
      id: 0,
      jsonrpc: '2.0',
      method: 'sign_message',
      params: {
        buff: Buffer.from(message).toString('base64'),
      },
    });
  }
}
