import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { In, IsNull } from 'typeorm';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { BankTx, BankTxType } from '../bank-tx/entities/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/repositories/bank-tx.repository';
import { BankTxRepeat } from './bank-tx-repeat.entity';
import { BankTxRepeatRepository } from './bank-tx-repeat.repository';
import { UpdateBankTxRepeatDto } from './dto/update-bank-tx-repeat.dto';

@Injectable()
export class BankTxRepeatService {
  constructor(
    private readonly bankTxRepeatRepo: BankTxRepeatRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly transactionService: TransactionService,
    private readonly userService: UserService,
  ) {}

  async create(bankTx: BankTx): Promise<BankTxRepeat> {
    let entity = await this.bankTxRepeatRepo.findOneBy({ bankTx: { id: bankTx.id } });
    if (entity) throw new BadRequestException('BankTx already used');

    const transaction = await this.transactionService.updateInternal(bankTx.transaction, {
      type: TransactionTypeInternal.BANK_TX_REPEAT,
    });

    entity = this.bankTxRepeatRepo.create({ bankTx, transaction });

    return this.bankTxRepeatRepo.save(entity);
  }

  async update(id: number, dto: UpdateBankTxRepeatDto): Promise<BankTxRepeat> {
    const entity = await this.bankTxRepeatRepo.findOne({
      where: { id },
      relations: { chargebackBankTx: true, sourceBankTx: true },
    });
    if (!entity) throw new NotFoundException('BankTxRepeat not found');

    const update = this.bankTxRepeatRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId && !entity.chargebackBankTx) {
      update.chargebackBankTx = await this.bankTxRepo.findOneBy({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new NotFoundException('ChargebackBankTx not found');

      const existingRepeatForChargeback = await this.bankTxRepeatRepo.findOneBy({
        chargebackBankTx: { id: dto.chargebackBankTxId },
      });
      if (existingRepeatForChargeback) throw new BadRequestException('ChargebackBankTx already used');

      await this.bankTxRepo.update(dto.chargebackBankTxId, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
    }

    // source bank tx
    if (dto.sourceBankTxId && !entity.sourceBankTx) {
      update.sourceBankTx = await this.bankTxRepo.findOneBy({ id: dto.sourceBankTxId });
      if (!update.sourceBankTx) throw new NotFoundException('SourceBankTx not found');

      const existingRepeatForSource = await this.bankTxRepeatRepo.findOneBy({
        sourceBankTx: { id: dto.sourceBankTxId },
      });
      if (existingRepeatForSource) throw new BadRequestException('SourceBankTx already used');
    }

    // user
    if (dto.userId) {
      update.user = await this.userService.getUser(dto.userId, { userData: true });
      if (!update.user) throw new NotFoundException('User not found');
      await this.transactionService.updateInternal(entity.transaction, {
        type: TransactionTypeInternal.BANK_TX_REPEAT,
        user: update.user,
        userData: update.user.userData,
      });
    }

    return this.updateInternal(entity, update);
  }

  async updateInternal(entity: BankTxRepeat, dto: Partial<BankTxRepeat>): Promise<BankTxRepeat> {
    const update = this.bankTxRepeatRepo.create(dto);

    return this.bankTxRepeatRepo.save({ ...update, ...Util.removeNullFields(entity) });
  }

  async getAllUserRepeats(userIds: number[]): Promise<BankTxRepeat[]> {
    return this.bankTxRepeatRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { bankTx: true, sourceBankTx: true, chargebackBankTx: true },
      order: { id: 'DESC' },
    });
  }

  async getPendingTx(): Promise<BankTxRepeat[]> {
    return this.bankTxRepeatRepo.find({
      where: { chargebackBankTx: { id: IsNull() } },
      relations: { chargebackBankTx: true, bankTx: true },
    });
  }

  async getBankTxRepeat(id: number): Promise<BankTxRepeat> {
    return this.bankTxRepeatRepo.findOneBy({ id });
  }
}
