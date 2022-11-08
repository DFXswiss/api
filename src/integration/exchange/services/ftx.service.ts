import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ftx } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class FtxService extends ExchangeService {
  constructor() {
    super(new ftx(GetConfig().exchange));
  }
}
