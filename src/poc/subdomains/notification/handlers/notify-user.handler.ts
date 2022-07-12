import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { MailService } from 'src/shared/services/mail.service';
import { NotifyUserCommand } from '../commands/notify-user.command';
import { UserNotifiedEvent } from '../events/user-notified.event';

@CommandHandler(NotifyUserCommand)
export class NotifyUserHandler implements ICommandHandler<NotifyUserCommand> {
  constructor(private readonly eventBus: EventBus, private readonly mailService: MailService) {}

  async execute(command: NotifyUserCommand) {
    const {
      payload: { userData, translationKey, params },
    } = command;

    await this.mailService.sendTranslatedMail({
      userData: userData,
      translationKey: translationKey,
      params: params,
    });

    this.eventBus.publish(new UserNotifiedEvent(command.correlationId));
  }
}
