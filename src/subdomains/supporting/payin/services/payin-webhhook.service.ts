import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LnBitsTransactionWebhookDto } from 'src/integration/lightning/dto/lnbits.dto';

@Injectable()
export class PayInWebHookService {
  private readonly lightningTransactionWebhookSubject: Subject<LnBitsTransactionWebhookDto>;

  constructor() {
    this.lightningTransactionWebhookSubject = new Subject<LnBitsTransactionWebhookDto>();
  }

  getLightningTransactionWebhookObservable(): Observable<LnBitsTransactionWebhookDto> {
    return this.lightningTransactionWebhookSubject.asObservable();
  }

  processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): void {
    this.lightningTransactionWebhookSubject.next(transactionWebhook);
  }
}
