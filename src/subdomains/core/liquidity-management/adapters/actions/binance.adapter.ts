import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { LiquidityManagementSystem } from '../../enums';
import { CctxExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CctxExchangeAdapter {
  constructor(binanceService: BinanceService) {
    super(LiquidityManagementSystem.BINANCE, binanceService);
  }
}
