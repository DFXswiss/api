import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LnBitsTransactionWebhookDto } from 'src/integration/lightning/dto/lnbits.dto';
import { C2BWebhookResult } from 'src/subdomains/core/payment-link/share/c2b-payment-link.provider';

@Injectable()
export class PayInWebHookService {
  private readonly lightningTransactionWebhookSubject: Subject<LnBitsTransactionWebhookDto>;
  private readonly binanceTransactionWebhookSubject: Subject<C2BWebhookResult>;
  private readonly kucoinTransactionWebhookSubject: Subject<C2BWebhookResult>;

  constructor() {
    this.lightningTransactionWebhookSubject = new Subject<LnBitsTransactionWebhookDto>();
    this.binanceTransactionWebhookSubject = new Subject<C2BWebhookResult>();
    this.kucoinTransactionWebhookSubject = new Subject<C2BWebhookResult>();
  }

  getLightningTransactionWebhookObservable(): Observable<LnBitsTransactionWebhookDto> {
    return this.lightningTransactionWebhookSubject.asObservable();
  }

  processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): void {
    this.lightningTransactionWebhookSubject.next(transactionWebhook);
  }

  getBinanceTransactionWebhookObservable(): Observable<C2BWebhookResult> {
    return this.binanceTransactionWebhookSubject.asObservable();
  }

  processBinanceTransaction(payWebhook: C2BWebhookResult): void {
    this.binanceTransactionWebhookSubject.next(payWebhook);
  }

  getKucoinTransactionWebhookObservable(): Observable<C2BWebhookResult> {
    return this.kucoinTransactionWebhookSubject.asObservable();
  }

  processKucoinTransaction(payWebhook: C2BWebhookResult): void {
    this.kucoinTransactionWebhookSubject.next(payWebhook);
  }
}
