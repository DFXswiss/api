import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { In, IsNull, MoreThan } from 'typeorm';
import { BankTxIndicator, BankTxUnassignedTypes } from '../../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../../bank-tx/bank-tx/services/bank-tx.service';
import { MailContext, MailType } from '../../notification/enums';
import { MailKey, MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { TransactionTypeInternal } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionNotificationService {
  private readonly logger = new DfxLogger(TransactionNotificationService);

  constructor(
    private readonly repo: TransactionRepository,
    private readonly notificationService: NotificationService,
    private readonly bankTxService: BankTxService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TX_MAIL, timeout: 1800 })
  async sendNotificationMails(): Promise<void> {
    await this.txAssigned();
    if (!DisabledProcess(Process.TX_UNASSIGNED_MAIL)) await this.txUnassigned();
  }

  private async txAssigned(): Promise<void> {
    const entities = await this.repo.find({
      where: {
        type: In([
          TransactionTypeInternal.BUY_CRYPTO,
          TransactionTypeInternal.BUY_FIAT,
          TransactionTypeInternal.CRYPTO_CRYPTO,
        ]),
        mailSendDate: IsNull(),
      },
      relations: {
        bankTx: true,
        buyCrypto: true,
        buyFiat: true,
        userData: { wallet: true },
        user: { wallet: true },
      },
    });

    for (const entity of entities) {
      try {
        if (
          !entity.targetEntity ||
          (!(entity.targetEntity instanceof BuyCrypto) && !(entity.targetEntity instanceof BuyFiat)) ||
          (!entity.targetEntity.comment && !entity.targetEntity.amlCheck)
        )
          continue;

        if (entity.userData?.mail)
          await this.notificationService.sendMail({
            type: MailType.USER_V2,
            context: entity.mailContext,
            input: {
              userData: entity.userData,
              wallet: entity.user.wallet,
              title: `${entity.targetEntity.inputMailTranslationKey}.title`,
              salutation: { key: `${entity.targetEntity.inputMailTranslationKey}.salutation` },
              texts: [
                {
                  key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                  params: { url: entity.url, button: 'true' },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.url, urlText: entity.url },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
                entity.bankTx && entity.bankTx.instructedCurrency !== entity.bankTx.currency
                  ? {
                      key: `${MailTranslationKey.FIAT_INPUT}.currency_exchange`,
                      params: {
                        bankAccount: Util.blankCenter(entity.bankTx.accountIban),
                        bankAsset: entity.bankTx.currency,
                        inputAsset: entity.bankTx.instructedCurrency,
                      },
                    }
                  : null,

                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });

        await this.repo.update(...entity.mailSent());
      } catch (e) {
        this.logger.error(`Failed to send tx assigned mail for ${entity.id}:`, e);
      }
    }
  }

  private async txUnassigned(): Promise<void> {
    const entities = await this.repo.find({
      where: {
        bankTx: { type: In(BankTxUnassignedTypes), creditDebitIndicator: BankTxIndicator.CREDIT },
        mailSendDate: IsNull(),
        created: MoreThan(Util.daysBefore(7)),
      },
      relations: { bankTx: true },
    });
    if (entities.length === 0) return;

    for (const entity of entities) {
      try {
        const userData = await this.bankTxService.getUserDataForBankTx(entity.bankTx, { wallet: true });
        if (!userData) continue;

        if (userData.mail) {
          await this.notificationService.sendMail({
            type: MailType.USER_V2,
            context: MailContext.UNASSIGNED_TX,
            input: {
              userData,
              wallet: userData.wallet,
              title: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.title`,
              salutation: { key: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.salutation` },
              texts: [
                {
                  key: `${MailTranslationKey.UNASSIGNED_FIAT_INPUT}.transaction_button`,
                  params: { url: entity.url, button: 'true' },
                },
                {
                  key: `${MailTranslationKey.GENERAL}.link`,
                  params: { url: entity.url, urlText: entity.url },
                },
                { key: MailKey.SPACE, params: { value: '4' } },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          });

          await this.repo.update(...entity.mailSent(userData));
        } else {
          await this.repo.update(entity.id, { userData });
        }
      } catch (e) {
        this.logger.error(`Failed to send tx unassigned mail for ${entity.id}:`, e);
      }
    }
  }
}
