import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
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
    private readonly userService: UserService,
  ) {}

  async create(bankTx: BankTx): Promise<BankTxRepeat> {
    let entity = this.bankTxRepeatRepo.create({ bankTx });
    if (entity) throw new BadRequestException('BankTx already used');

    entity = this.bankTxRepeatRepo.create({ bankTx });

    return await this.bankTxRepeatRepo.save(entity);
  }

  async update(id: number, dto: UpdateBankTxRepeatDto): Promise<BankTxRepeat> {
    const entity = await this.bankTxRepeatRepo.findOne({
      where: { id },
      relations: ['chargebackBankTx', 'sourceBankTx', 'user'],
    });
    if (!entity) throw new NotFoundException('BankTxRepeat not found');

    const update = this.bankTxRepeatRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId && !entity.chargebackBankTx) {
      update.chargebackBankTx = await this.bankTxRepo.findOne({ where: { id: dto.chargebackBankTxId } });
      if (!update.chargebackBankTx) throw new NotFoundException('ChargebackBankTx not found');

      const existingReturnForChargeback = await this.bankTxRepeatRepo.findOne({
        where: { chargebackBankTx: { id: dto.chargebackBankTxId } },
      });
      if (existingReturnForChargeback) throw new BadRequestException('ChargebackBankTx already used');

      await this.bankTxRepo.update(dto.chargebackBankTxId, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
    }

    // source bank tx
    if (dto.sourceBankTxId && !entity.sourceBankTx) {
      update.sourceBankTx = await this.bankTxRepo.findOne({ where: { id: dto.sourceBankTxId } });
      if (!update.sourceBankTx) throw new NotFoundException('SourceBankTx not found');

      const existingSourceBankTx = await this.bankTxRepeatRepo.findOne({
        where: { sourceBankTx: { id: dto.sourceBankTxId } },
      });
      if (existingSourceBankTx) throw new BadRequestException('SourceBankTx already used');
    }

    // user
    if (dto.userId && !entity.user) {
      update.user = await this.userService.getUser(dto.userId);
      if (!update.user) throw new NotFoundException('User not found');
    }

    Util.removeNullFields(entity);

    return await this.bankTxRepeatRepo.save({ ...update, ...entity });
  }
}
