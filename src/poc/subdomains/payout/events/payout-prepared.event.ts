import { IEvent } from 'src/poc/shared/events/event';

interface PayoutPreparedEventPayload {
  payoutReservationId: string;
}

export class PayoutPreparedEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload: PayoutPreparedEventPayload) {
    super(correlationId, payload);
  }
}
