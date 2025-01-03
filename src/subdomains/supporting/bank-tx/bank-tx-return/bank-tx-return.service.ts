import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BankTxRefund, RefundInternalDto } from 'src/subdomains/core/history/dto/refund-internal.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { IsNull } from 'typeorm';
import { FiatOutputService } from '../../fiat-output/fiat-output.service';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { BankTx, BankTxType } from '../bank-tx/entities/bank-tx.entity';
import { BankTxRepository } from '../bank-tx/repositories/bank-tx.repository';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';
import { UpdateBankTxReturnDto } from './dto/update-bank-tx-return.dto';

@Injectable()
export class BankTxReturnService {
  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly transactionService: TransactionService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly fiatOutputService: FiatOutputService,
  ) {}

  async create(bankTx: BankTx): Promise<BankTxReturn> {
    let entity = await this.bankTxReturnRepo.findOneBy({ bankTx: { id: bankTx.id } });
    if (entity) throw new BadRequestException('BankTx already used');

    const transaction = await this.transactionService.updateInternal(bankTx.transaction, {
      type: TransactionTypeInternal.BANK_TX_RETURN,
    });

    entity = this.bankTxReturnRepo.create({ bankTx, transaction, userData: bankTx.transaction.userData });

    return this.bankTxReturnRepo.save(entity);
  }

  async update(id: number, dto: UpdateBankTxReturnDto): Promise<BankTxReturn> {
    const entity = await this.bankTxReturnRepo.findOne({ where: { id }, relations: { chargebackBankTx: true } });
    if (!entity) throw new NotFoundException('BankTxReturn not found');

    const update = this.bankTxReturnRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId && !entity.chargebackBankTx) {
      update.chargebackBankTx = await this.bankTxRepo.findOneBy({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new BadRequestException('ChargebackBankTx not found');

      const existingReturnForChargeback = await this.bankTxReturnRepo.findOneBy({
        chargebackBankTx: { id: dto.chargebackBankTxId },
      });
      if (existingReturnForChargeback) throw new BadRequestException('ChargebackBankTx already used');

      await this.bankTxRepo.update(dto.chargebackBankTxId, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
    }

    Util.removeNullFields(entity);

    return this.bankTxReturnRepo.save({ ...update, ...entity });
  }

  async getPendingTx(): Promise<BankTxReturn[]> {
    return this.bankTxReturnRepo.find({
      where: { chargebackBankTx: { id: IsNull() } },
      relations: { chargebackBankTx: true, bankTx: true },
    });
  }

  async refundBankTxReturn(buyCryptoId: number, dto: RefundInternalDto): Promise<void> {
    const bankTxReturn = await this.bankTxReturnRepo.findOne({
      where: { id: buyCryptoId },
      relations: { transaction: { userData: true }, bankTx: true },
    });

    if (!bankTxReturn) throw new NotFoundException('BankTxReturn not found');

    return this.refundBankTx(bankTxReturn, {
      refundIban: dto.refundIban,
      chargebackAmount: dto.chargebackAmount,
      chargebackAllowedDate: dto.chargebackAllowedDate,
      chargebackAllowedBy: dto.chargebackAllowedBy,
    });
  }

  async refundBankTx(bankTxReturn: BankTxReturn, dto: BankTxRefund): Promise<void> {
    const chargebackAmount = dto.chargebackAmount ?? bankTxReturn.chargebackAmount;
    const chargebackIban = dto.refundIban ?? bankTxReturn.chargebackIban;

    if (!chargebackIban) throw new BadRequestException('You have to define a chargebackIban');

    TransactionUtilService.validateRefund(bankTxReturn, {
      refundIban: chargebackIban,
      chargebackAmount,
    });

    if (!(await this.transactionUtilService.validateChargebackIban(chargebackIban)))
      throw new BadRequestException('IBAN not valid or BIC not available');

    if (dto.chargebackAllowedDate && chargebackAmount) {
      dto.chargebackOutput = await this.fiatOutputService.createInternal('BankTxReturn', { bankTxReturn });
    }

    await this.bankTxReturnRepo.update(
      ...bankTxReturn.chargebackFillUp(
        chargebackIban,
        chargebackAmount,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        dto.chargebackOutput,
      ),
    );
  }
}
