import { ICommand } from 'src/poc/shared/events/command';

interface DoPayoutCommandPayload {
  payoutReservationId: string;
}

export class DoPayoutCommand extends ICommand {
  constructor(readonly correlationId: string, readonly payload: DoPayoutCommandPayload) {
    super(correlationId, payload);
  }
}
