import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { ClementineClient } from './clementine-client';

@Injectable()
export class ClementineService {
  private readonly client: ClementineClient;

  constructor() {
    const config = GetConfig().blockchain.clementine;
    this.client = new ClementineClient(config);
  }

  getDefaultClient(): ClementineClient {
    return this.client;
  }
}
