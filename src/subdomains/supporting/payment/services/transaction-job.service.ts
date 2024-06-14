import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { Transaction, TransactionSourceType, TransactionTypeInternal } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionJobService {
  private readonly logger = new DfxLogger(TransactionJobService);

  constructor(
    private readonly repo: TransactionRepository,
    private readonly settingService: SettingService,
    private readonly userService: UserService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async syncUsers(): Promise<void> {
    if (DisabledProcess(Process.SYNCHRONIZE_TRANSACTION_USER)) return;

    const date = await this.settingService.get('transactionFilterDate', '2022-07-31');

    const entities = await this.repo.find({
      where: {
        user: IsNull(),
        type: Not(In([TransactionTypeInternal.INTERNAL, TransactionTypeInternal.BANK_TX_RETURN])),
        created: LessThanOrEqual(new Date(date)),
      },
      relations: {
        cryptoInput: { route: { user: true } },
        bankTx: { buyFiat: { sell: { user: true } }, buyCryptoChargeback: { buy: { user: true } } },
        bankTxRepeat: true,
      },
    });

    for (const entity of entities) {
      try {
        if (!entity.type) continue;

        const user = await this.getUser(entity);
        if (!user) continue;
        await this.repo.update(entity.id, { user });
      } catch (e) {
        this.logger.error(`Error during synchronize transactions ${entity.id}:`, e);
      }
    }
  }

  private async getUser(entity: Transaction): Promise<User> {
    switch (entity.sourceType) {
      case TransactionSourceType.BANK_TX:
        if (entity.type === TransactionTypeInternal.BANK_TX_REPEAT)
          return !entity.bankTx.bankTxRepeat.userId
            ? undefined
            : this.userService.getUser(entity.bankTx.bankTxRepeat.userId);

        return entity.bankTx.buyFiat?.user ?? entity.bankTx.buyCryptoChargeback?.user;

      case TransactionSourceType.CRYPTO_INPUT:
        return entity.cryptoInput.route.user;
    }
  }
}
