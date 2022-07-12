import { IEvent } from 'src/poc/shared/events/event';

export class UserNotifiedEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload = null) {
    super(correlationId, payload);
  }
}
