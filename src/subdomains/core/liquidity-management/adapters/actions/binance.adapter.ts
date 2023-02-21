import { Injectable } from '@nestjs/common';
import { CctxExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CctxExchangeAdapter {}
