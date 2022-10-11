import { BadRequestException, Injectable } from '@nestjs/common';
import { BankTx, BankTxType } from '../bank-tx/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/bank-tx.repository';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';

export interface BankTxReturnInterface {
  bankTx: BankTx;
  chargebackBankTxId: number;
  info: string;
}

@Injectable()
export class BankTxReturnService {
  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly bankTxRepo: BankTxRepository,
  ) {}

  async create(bankTxReturn: BankTxReturnInterface): Promise<BankTxReturn> {
    let entity = await this.bankTxReturnRepo.findOne({ where: { bankTx: { id: bankTxReturn.bankTx.id } } });
    if (entity) throw new BadRequestException('BankTx already used');

    const chargebackBankTx = await this.bankTxRepo.findOne({ where: { id: bankTxReturn.chargebackBankTxId } });
    if (!chargebackBankTx) throw new BadRequestException('ChargebackBankTx not found');

    entity = await this.bankTxReturnRepo.findOne({ where: { chargebackBankTx: { id: chargebackBankTx.id } } });
    if (entity) throw new BadRequestException('ChargebackBankTx already used');

    await this.bankTxRepo.update(chargebackBankTx.id, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });

    entity = this.bankTxReturnRepo.create({ ...bankTxReturn, chargebackBankTx });

    return await this.bankTxReturnRepo.save(entity);
  }
}
