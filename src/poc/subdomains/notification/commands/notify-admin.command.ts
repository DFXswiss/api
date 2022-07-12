import { ICommand } from 'src/poc/shared/events/command';

interface NotifyAdminCommandPayload {
  subject: string;
  errors: string[];
}

export class NotifyAdminCommand extends ICommand {
  constructor(readonly correlationId: string, readonly payload: NotifyAdminCommandPayload) {
    super(correlationId, payload);
  }
}
