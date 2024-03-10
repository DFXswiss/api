import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { TransactionSourceType, TransactionType } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { BankTx, BankTxType } from '../bank-tx/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { BankTxRepeat } from './bank-tx-repeat.entity';
import { BankTxRepeatRepository } from './bank-tx-repeat.repository';
import { UpdateBankTxRepeatDto } from './dto/update-bank-tx-repeat.dto';

@Injectable()
export class BankTxRepeatService {
  constructor(
    private readonly bankTxRepeatRepo: BankTxRepeatRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly transactionService: TransactionService,
  ) {}

  async create(bankTx: BankTx): Promise<BankTxRepeat> {
    let entity = await this.bankTxRepeatRepo.findOneBy({ bankTx: { id: bankTx.id } });
    if (entity) throw new BadRequestException('BankTx already used');

    const transaction = !DisabledProcess(Process.CREATE_TRANSACTION)
      ? await this.transactionService.update(bankTx.id, TransactionSourceType.BANK_TX, {
          type: TransactionType.BANK_TX_REPEAT,
        })
      : null;

    entity = this.bankTxRepeatRepo.create({ bankTx, transaction });

    return this.bankTxRepeatRepo.save(entity);
  }

  async update(id: number, dto: UpdateBankTxRepeatDto): Promise<BankTxRepeat> {
    const entity = await this.bankTxRepeatRepo.findOne({
      where: { id },
      relations: ['chargebackBankTx', 'sourceBankTx'],
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

    Util.removeNullFields(entity);

    return this.bankTxRepeatRepo.save({ ...update, ...entity });
  }

  async getAllUserRepeats(userIds: number[]): Promise<BankTxRepeat[]> {
    return this.bankTxRepeatRepo.find({
      where: { userId: In(userIds) },
      relations: ['bankTx', 'sourceBankTx', 'chargebackBankTx'],
      order: { id: 'DESC' },
    });
  }
}
