import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxType } from '../bank-tx/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';
import { UpdateBankTxReturnDto } from './dto/update-bank-tx-return.dto';

@Injectable()
export class BankTxReturnService {
  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly bankTxRepo: BankTxRepository,
  ) {}

  async create(bankTx: BankTx): Promise<BankTxReturn> {
    let entity = await this.bankTxReturnRepo.findOne({ where: { bankTx: { id: bankTx.id } } });
    if (entity) throw new BadRequestException('BankTx already used');

    entity = this.bankTxReturnRepo.create({ bankTx });

    return this.bankTxReturnRepo.save(entity);
  }

  async update(id: number, dto: UpdateBankTxReturnDto): Promise<BankTxReturn> {
    const entity = await this.bankTxReturnRepo.findOne({ where: { id }, relations: ['chargebackBankTx'] });
    if (!entity) throw new NotFoundException('BankTxReturn not found');

    const update = this.bankTxReturnRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId && !entity.chargebackBankTx) {
      update.chargebackBankTx = await this.bankTxRepo.findOne({ where: { id: dto.chargebackBankTxId } });
      if (!update.chargebackBankTx) throw new BadRequestException('ChargebackBankTx not found');

      const existingReturnForChargeback = await this.bankTxReturnRepo.findOne({
        where: { chargebackBankTx: { id: dto.chargebackBankTxId } },
      });
      if (existingReturnForChargeback) throw new BadRequestException('ChargebackBankTx already used');

      await this.bankTxRepo.update(dto.chargebackBankTxId, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
    }

    Util.removeNullFields(entity);

    return this.bankTxReturnRepo.save({ ...update, ...entity });
  }
}
