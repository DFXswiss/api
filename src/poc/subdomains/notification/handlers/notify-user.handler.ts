import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { MailService } from 'src/shared/services/mail.service';
import { Util } from 'src/shared/util';
import { NotifyUserCommand } from '../commands/notify-user.command';
import { UserNotifiedEvent } from '../events/user-notified.event';

@CommandHandler(NotifyUserCommand)
export class NotifyUserHandler implements ICommandHandler<NotifyUserCommand> {
  constructor(private readonly eventBus: EventBus, private readonly mailService: MailService) {}

  async execute(command: NotifyUserCommand) {
    const { tx } = command;

    tx.targetAddress &&
      (await this.mailService.sendTranslatedMail({
        userData: tx.buy.user.userData,
        translationKey: 'mail.payment.buyCrypto',
        params: {
          buyFiatAmount: tx.inputAmount,
          buyFiatAsset: tx.inputAsset,
          buyCryptoAmount: tx.outputAmount,
          buyCryptoAsset: tx.outputAsset,
          buyFeePercentage: Util.round(tx.percentFee * 100, 2),
          exchangeRate: Util.round(tx.inputAmount / tx.outputAmount, 2),
          buyWalletAddress: Util.trimBlockchainAddress(tx.targetAddress),
          buyTxId: tx.txId,
        },
      }));

    this.eventBus.publish(new UserNotifiedEvent(tx.id));
  }
}
