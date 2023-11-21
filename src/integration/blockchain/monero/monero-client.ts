import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { VerifyResultDto } from './dto/monero.dto';

export class MoneroClient {
  constructor(private readonly http: HttpService) {}

  async verifySignature(message: string, address: string, signature: string): Promise<VerifyResultDto> {
    return this.http
      .post<{ result: VerifyResultDto }>(
        `${Config.blockchain.monero.rpc.url}`,
        {
          method: 'verify',
          params: { data: message, address: address, signature: signature },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  private httpConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.monero.rpc.certificate,
      }),
    };
  }
}
