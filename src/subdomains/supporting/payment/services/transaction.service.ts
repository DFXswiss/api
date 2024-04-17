import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Between, FindOptionsRelations, In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { MailType } from '../../notification/enums';
import { MailKey, MailTranslationKey } from '../../notification/factories/mail.factory';
import { NotificationService } from '../../notification/services/notification.service';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  private readonly logger = new DfxLogger(TransactionService);

  constructor(
    private readonly repo: TransactionRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    let entity = await this.getTransaction(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);

    entity = await this.repo.save(entity);

    await this.txConfirmedMail(entity);

    return entity;
  }

  async getTransaction(id: number, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async getTransactionsWithoutUser(filterDate: Date): Promise<Transaction[]> {
    return this.repo.find({
      where: [
        { user: IsNull(), created: LessThanOrEqual(filterDate), buyCrypto: { id: Not(IsNull()) } },
        { user: IsNull(), created: LessThanOrEqual(filterDate), buyFiat: { id: Not(IsNull()) } },
        { user: IsNull(), created: LessThanOrEqual(filterDate), refReward: { id: Not(IsNull()) } },
      ],
      relations: {
        user: true,
        buyCrypto: { buy: { user: true }, cryptoRoute: { user: true } },
        buyFiat: { sell: { user: true } },
        refReward: { user: true },
      },
    });
  }

  async getTransactionsForUsers(users: User[], from = new Date(0), to = new Date()): Promise<Transaction[]> {
    return this.repo.find({
      where: { user: { id: In(users.map((u) => u.id)) }, type: Not(IsNull()), created: Between(from, to) },
      relations: {
        buyCrypto: {
          buy: { user: true },
          cryptoRoute: { user: true },
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
        },
        buyFiat: { sell: { user: true }, cryptoInput: true, bankTx: true },
        refReward: { user: true },
      },
    });
  }

  private async txConfirmedMail(entity: Transaction): Promise<void> {
    try {
      if (entity.mailTarget?.userData.mail && !DisabledProcess(Process.TX_MAIL)) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          context: entity.mailContext,
          input: {
            userData: entity.mailTarget.userData,
            title: `${entity.mailTarget.inputMailTranslationKey}.title`,
            salutation: { key: `${entity.mailTarget.inputMailTranslationKey}.salutation` },
            suffix: [
              {
                key: `${MailTranslationKey.PAYMENT}.transaction_button`,
                params: { url: entity.url },
              },
              {
                key: `${MailTranslationKey.GENERAL}.link`,
                params: { url: entity.url },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });

        await this.repo.update(...entity.confirmSentMail());
      }
    } catch (e) {
      this.logger.error(`Failed to send tx mail for ${entity.id}:`, e);
    }
  }
}
