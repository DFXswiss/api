import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { MoneroClient } from '../monero-client';

@Injectable()
export class MoneroService {
  private readonly logger = new DfxLogger(MoneroService);

  private readonly client: MoneroClient;

  constructor(private readonly http: HttpService) {
    this.client = new MoneroClient(http);
  }

  getDefaultClient(): MoneroClient {
    return this.client;
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return this.client.verifySignature(message, address, signature).then((v) => v.good);
  }
}
