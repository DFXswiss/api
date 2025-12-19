import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BankTxRefund, RefundInternalDto } from 'src/subdomains/core/history/dto/refund-internal.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { IsNull, Not } from 'typeorm';
import { FiatOutputType } from '../../fiat-output/fiat-output.entity';
import { FiatOutputService } from '../../fiat-output/fiat-output.service';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { PriceCurrency, PriceValidity, PricingService } from '../../pricing/services/pricing.service';
import { BankTx } from '../bank-tx/entities/bank-tx.entity';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';
import { UpdateBankTxReturnDto } from './dto/update-bank-tx-return.dto';

@Injectable()
export class BankTxReturnService {
  private readonly logger = new DfxLogger(BankTxReturnService);

  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly transactionService: TransactionService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
  ) {}

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BANK_TX_RETURN, timeout: 1800 })
  async fillBankTxReturn() {
    await this.setFiatAmounts();
  }

  async setFiatAmounts(): Promise<void> {
    const entities = await this.bankTxReturnRepo.find({
      where: {
        chargebackOutput: { id: Not(IsNull()), currency: Not(IsNull()), amount: Not(IsNull()) },
        bankTx: { id: Not(IsNull()) },
        amountInEur: IsNull(),
        chargebackRemittanceInfo: Not(IsNull()),
      },
      relations: { chargebackOutput: true, bankTx: true },
    });

    for (const entity of entities) {
      try {
        const inputCurrency = await this.fiatService.getFiatByName(entity.chargebackOutput.currency);

        const eurPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.EUR, PriceValidity.VALID_ONLY);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.CHF, PriceValidity.VALID_ONLY);
        const usdPrice = await this.pricingService.getPrice(inputCurrency, PriceCurrency.USD, PriceValidity.VALID_ONLY);

        await this.bankTxReturnRepo.update(
          ...entity.setFiatAmount(
            eurPrice.convert(entity.chargebackOutput.amount, 2),
            chfPrice.convert(entity.chargebackOutput.amount, 2),
            usdPrice.convert(entity.chargebackOutput.amount, 2),
          ),
        );
      } catch (e) {
        this.logger.error(`Error during bankTxReturn ${entity.id} set fiat amounts:`, e);
      }
    }
  }

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

    return this.updateInternal(entity, dto);
  }

  async updateInternal(entity: BankTxReturn, dto: Partial<BankTxReturn>): Promise<BankTxReturn> {
    const update = this.bankTxReturnRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTx && !entity.chargebackBankTx) {
      const existingReturnForChargeback = await this.bankTxReturnRepo.findOneBy({
        chargebackBankTx: { id: dto.chargebackBankTx.id },
      });
      if (existingReturnForChargeback) throw new BadRequestException('ChargebackBankTx already used');
    }

    return this.bankTxReturnRepo.save({ ...update, ...Util.removeNullFields(entity) });
  }

  async getBankTxReturn(id: number): Promise<BankTxReturn> {
    return this.bankTxReturnRepo.findOneBy({ id });
  }

  async getBankTxReturnsByIban(iban: string): Promise<BankTxReturn[]> {
    return this.bankTxReturnRepo.find({
      where: { chargebackIban: iban },
      relations: { userData: true },
    });
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
      relations: { transaction: { userData: true }, bankTx: true, chargebackOutput: true },
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

    if (
      !(await this.transactionUtilService.validateChargebackIban(
        chargebackIban,
        chargebackIban !== bankTxReturn.bankTx.iban,
      ))
    )
      throw new BadRequestException('IBAN not valid or BIC not available');

    if (dto.chargebackAllowedDate && chargebackAmount) {
      dto.chargebackOutput = await this.fiatOutputService.createInternal(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn },
        bankTxReturn.id,
      );
    }

    await this.bankTxReturnRepo.update(
      ...bankTxReturn.chargebackFillUp(
        chargebackIban,
        chargebackAmount,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        dto.chargebackOutput,
        bankTxReturn.chargebackBankRemittanceInfo,
      ),
    );
  }
}
