import { IEvent } from 'src/poc/shared/events/event';

export interface BankTransactionCompleteEventPayload {
  buyCryptoId: number;
}

export class BankTransactionCompleteEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload: BankTransactionCompleteEventPayload) {
    super(correlationId, payload);
  }
}
