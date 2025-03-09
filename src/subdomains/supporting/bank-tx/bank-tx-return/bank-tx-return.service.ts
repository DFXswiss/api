import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit, forwardRef } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BankTxRefund, RefundInternalDto } from 'src/subdomains/core/history/dto/refund-internal.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { IsNull, Not } from 'typeorm';
import { FiatOutputService } from '../../fiat-output/fiat-output.service';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { BankTx, BankTxType } from '../bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/services/bank-tx.service';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';
import { UpdateBankTxReturnDto } from './dto/update-bank-tx-return.dto';

@Injectable()
export class BankTxReturnService implements OnModuleInit {
  private readonly logger = new DfxLogger(BankTxReturnService);
  private chf: Fiat;
  private eur: Fiat;
  private usd: Fiat;

  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    private readonly transactionService: TransactionService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
    void this.fiatService.getFiatByName('EUR').then((f) => (this.eur = f));
    void this.fiatService.getFiatByName('USD').then((f) => (this.usd = f));
  }

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BANK_TX_RETURN, timeout: 1800 })
  async fillBankTxReturn() {
    await this.setRemittanceInfo();
    await this.setFiatAmounts();
  }

  async setRemittanceInfo(): Promise<void> {
    const entities = await this.bankTxReturnRepo.find({
      where: {
        bankTx: { id: Not(IsNull()) },
        chargebackRemittanceInfo: IsNull(),
      },
      relations: { bankTx: true },
    });

    for (const entity of entities) {
      try {
        await this.bankTxReturnRepo.update(...entity.setRemittanceInfo());
      } catch (e) {
        this.logger.error(`Error during bankTxReturn ${entity.id} set remittanceInfo:`, e);
      }
    }
  }

  async setFiatAmounts(): Promise<void> {
    const entities = await this.bankTxReturnRepo.find({
      where: {
        chargebackBankTx: { id: IsNull() },
        bankTx: { id: Not(IsNull()) },
        amountInEur: Not(IsNull()),
        chargebackRemittanceInfo: Not(IsNull()),
      },
      relations: { chargebackBankTx: true, bankTx: true },
    });

    for (const entity of entities) {
      try {
        const bankTxChargeback = await this.bankTxService.getBankTxByRemittanceInfo(entity.chargebackRemittanceInfo);
        if (!bankTxChargeback) continue;

        const inputCurrency = await this.fiatService.getFiatByName(entity.bankTx.currency);

        const eurPrice = await this.pricingService.getPrice(inputCurrency, this.eur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, this.chf, false);
        const usdPrice = await this.pricingService.getPrice(inputCurrency, this.usd, false);

        await this.bankTxReturnRepo.update(
          ...entity.setFiatAmount(
            eurPrice.convert(entity.bankTx.amount, 2),
            chfPrice.convert(entity.bankTx.amount, 2),
            usdPrice.convert(entity.bankTx.amount, 2),
            bankTxChargeback,
          ),
        );
        await this.bankTxService.updateInternal(bankTxChargeback, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
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

    const update = this.bankTxReturnRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId && !entity.chargebackBankTx) {
      update.chargebackBankTx = await this.bankTxService.getBankTxById(dto.chargebackBankTxId);
      if (!update.chargebackBankTx) throw new BadRequestException('ChargebackBankTx not found');

      const existingReturnForChargeback = await this.bankTxReturnRepo.findOneBy({
        chargebackBankTx: { id: dto.chargebackBankTxId },
      });
      if (existingReturnForChargeback) throw new BadRequestException('ChargebackBankTx already used');

      await this.bankTxService.updateInternal(update.chargebackBankTx, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
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
