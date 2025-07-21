import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { ZanoClient } from '../zano-client';

@Injectable()
export class ZanoService {
  private readonly client: ZanoClient;

  constructor(private readonly http: HttpService) {
    this.client = new ZanoClient(this.http);
  }

  getDefaultClient(): ZanoClient {
    return this.client;
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return this.client.verifySignature(message, address, signature);
  }
}
