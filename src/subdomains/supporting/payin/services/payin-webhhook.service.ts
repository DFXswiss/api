import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LnBitsTransactionWebhookDto } from 'src/integration/lightning/dto/lnbits.dto';
import { WebhookResult } from 'src/subdomains/core/payment-link/share/IPaymentLinkProvider';

@Injectable()
export class PayInWebHookService {
  private readonly lightningTransactionWebhookSubject: Subject<LnBitsTransactionWebhookDto>;
  private readonly binanceTransactionWebhookSubject: Subject<WebhookResult>;

  constructor() {
    this.lightningTransactionWebhookSubject = new Subject<LnBitsTransactionWebhookDto>();
    this.binanceTransactionWebhookSubject = new Subject<WebhookResult>();
  }

  getLightningTransactionWebhookObservable(): Observable<LnBitsTransactionWebhookDto> {
    return this.lightningTransactionWebhookSubject.asObservable();
  }

  processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): void {
    this.lightningTransactionWebhookSubject.next(transactionWebhook);
  }

  getBinanceTransactionWebhookObservable(): Observable<WebhookResult> {
    return this.binanceTransactionWebhookSubject.asObservable();
  }

  processBinanceTransaction(payWebhook: WebhookResult): void {
    this.binanceTransactionWebhookSubject.next(payWebhook);
  }
}
