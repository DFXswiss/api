import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BoltzClient } from './boltz-client';

@Injectable()
export class BoltzService {
  private readonly client: BoltzClient;

  constructor(http: HttpService) {
    const config = GetConfig().blockchain.boltz;
    this.client = new BoltzClient(http, config);
  }

  getDefaultClient(): BoltzClient {
    return this.client;
  }
}
