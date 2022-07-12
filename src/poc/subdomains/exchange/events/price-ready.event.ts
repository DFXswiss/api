import { Price } from 'src/payment/models/exchange/dto/price.dto';
import { IEvent } from 'src/poc/shared/events/event';

export class PriceReceivedEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload: Price) {
    super(correlationId, payload);
  }
}
