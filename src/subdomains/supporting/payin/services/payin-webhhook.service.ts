import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { BinancePayWebhookDto } from 'src/integration/c2b-payment-link/binance/dto/binance.dto';
import { LnBitsTransactionWebhookDto } from 'src/integration/lightning/dto/lnbits.dto';

@Injectable()
export class PayInWebHookService {
  private readonly lightningTransactionWebhookSubject: Subject<LnBitsTransactionWebhookDto>;
  private readonly binanceTransactionWebhookSubject: Subject<BinancePayWebhookDto>;

  constructor() {
    this.lightningTransactionWebhookSubject = new Subject<LnBitsTransactionWebhookDto>();
    this.binanceTransactionWebhookSubject = new Subject<BinancePayWebhookDto>();
  }

  getLightningTransactionWebhookObservable(): Observable<LnBitsTransactionWebhookDto> {
    return this.lightningTransactionWebhookSubject.asObservable();
  }

  processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): void {
    this.lightningTransactionWebhookSubject.next(transactionWebhook);
  }

  getBinanceTransactionWebhookObservable(): Observable<BinancePayWebhookDto> {
    return this.binanceTransactionWebhookSubject.asObservable();
  }

  processBinanceTransaction(dto: BinancePayWebhookDto): void {
    this.binanceTransactionWebhookSubject.next(dto);
  }
}
