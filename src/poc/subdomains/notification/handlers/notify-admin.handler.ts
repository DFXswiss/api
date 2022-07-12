import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MailService } from 'src/shared/services/mail.service';
import { NotifyAdminCommand } from '../commands/notify-admin.command';

@CommandHandler(NotifyAdminCommand)
export class NotifyAdminHandler implements ICommandHandler<NotifyAdminCommand> {
  constructor(private readonly mailService: MailService) {}

  async execute(command: NotifyAdminCommand) {
    const {
      payload: { subject, errors },
    } = command;

    await this.mailService.sendErrorMail(subject, errors);
  }
}
