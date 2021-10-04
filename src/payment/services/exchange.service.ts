import { Injectable } from '@nestjs/common';
import { Exchange, kraken as Kraken } from 'ccxt';

@Injectable()
export class ExchangeService {
  private readonly kraken: Exchange;

  constructor() {
    this.kraken = new Kraken({ apiKey: 'todo-api-key-here', secret: 'todo-secret-here', timeout: 30000 });
  }

  async test() {
    const markets = await this.kraken.loadMarkets();
    console.log(markets);
  }
}
