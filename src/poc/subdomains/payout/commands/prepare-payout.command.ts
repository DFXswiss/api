import { ICommand } from 'src/poc/shared/events/command';

interface PreparePayoutCommandPayload {
  asset: string;
  amount: number;
  destination: string;
}

export class PreparePayoutCommand extends ICommand {
  constructor(readonly correlationId: string, readonly payload: PreparePayoutCommandPayload) {
    super(correlationId, payload);
  }
}
