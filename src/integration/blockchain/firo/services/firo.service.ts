import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { FiroClient } from '../firo-client';

@Injectable()
export class FiroService extends BlockchainService {
  private readonly client: FiroClient;

  constructor(private readonly http: HttpService) {
    super();

    const url = Config.blockchain.firo.node.url;
    this.client = url ? new FiroClient(this.http, url) : undefined;
  }

  getDefaultClient(): FiroClient {
    return this.client;
  }

  getPaymentRequest(address: string, amount: number): string {
    return `firo:${address}?amount=${Util.numberToFixedString(amount)}`;
  }
}
