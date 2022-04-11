import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { WhaleClient } from './whale-client';
@Injectable()
export class WhaleService {
  private readonly client: WhaleClient;

  constructor() {
    this.client = new WhaleClient();
  }

  getClient(): WhaleClient {
    if (!this.client) throw new InternalServerErrorException(`Whale client init failed`);
    return this.client;
  }
}
