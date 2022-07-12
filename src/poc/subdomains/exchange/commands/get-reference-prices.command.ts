import { ICommand } from 'src/poc/shared/events/command';

export interface GetReferencePricesCommandPayload {
  from: string;
  to: string;
  options?: GetReferencePricesCommandOptions;
}

export interface GetReferencePricesCommandOptions {
  amount?: number;
}

export class GetReferencePricesCommand extends ICommand {
  constructor(readonly correlationId: string, readonly payload: GetReferencePricesCommandPayload) {
    super(correlationId, payload);
  }
}
