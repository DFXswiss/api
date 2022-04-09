import { BadRequestException, Injectable } from '@nestjs/common';
import { WhaleClient } from './whale-client';
@Injectable()
export class WhaleService {
  private readonly client: WhaleClient;

  constructor() {
    this.client = this.createWhaleClient();
  }
  getClient(): WhaleClient {
    const client = this.client;
    if (client) {
      return client;
    }

    throw new BadRequestException(`Fails during init`);
  }

  // --- HELPER METHODS --- //

  // utility
  createWhaleClient(): WhaleClient {
    return new WhaleClient();
  }
}
