import { IEvent } from 'src/poc/shared/events/event';

interface PayoutCompleteEventPayload {
  payoutTransactionId: string;
}

export class PayoutCompleteEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload: PayoutCompleteEventPayload) {
    super(correlationId, payload);
  }
}
