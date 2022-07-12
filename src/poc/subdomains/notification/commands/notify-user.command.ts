import { ICommand } from 'src/poc/shared/events/command';
import { UserData } from 'src/user/models/user-data/user-data.entity';

interface NotifyUserCommandPayload {
  userData: UserData;
  translationKey: string;
  params: {
    [key: string]: any;
  };
}

export class NotifyUserCommand extends ICommand {
  constructor(readonly correlationId: string, readonly payload: NotifyUserCommandPayload) {
    super(correlationId, payload);
  }
}
