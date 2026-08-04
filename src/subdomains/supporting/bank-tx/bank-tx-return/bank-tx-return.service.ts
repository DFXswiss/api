import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BankTxRefund, RefundInternalDto } from 'src/subdomains/core/history/dto/refund-internal.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
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

  // Compare-and-swap predicate for a refund: every column validateRefund rejects on, plus the
  // user-request marker as observed. Pinning that marker to its current value rather than IsNull()
  // keeps a user re-submitting their refund details working, while still losing to a concurrent
  // claim. Callers must not write any of these columns before the claim runs.
  private static refundClaimWhere(entity: BankTxReturn): FindOptionsWhere<BankTxReturn> {
    return {
      id: entity.id,
      chargebackOutput: IsNull(),
      chargebackAllowedDate: IsNull(),
      chargebackAllowedDateUser: entity.chargebackAllowedDateUser ?? IsNull(),
      chargebackDate: IsNull(),
      chargebackBankTx: IsNull(),
    };
  }

  constructor(
    private readonly bankTxReturnRepo: BankTxReturnRepository,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    @Inject(forwardRef(() => FiatOutputService))
    private readonly fiatOutputService: FiatOutputService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
  ) {}

  @DfxCron(CronExpression.EVERY_5_MINUTES, { scope: CronScope.WORKER, process: Process.BANK_TX_RETURN, timeout: 1800 })
  async fillBankTxReturn() {
    await this.chargebackTx();
    await this.setFiatAmounts();
  }

  async chargebackTx(): Promise<void> {
    const baseWhere = {
      chargebackAllowedDate: IsNull(),
      chargebackAllowedDateUser: Not(IsNull()),
      chargebackAmount: Not(IsNull()),
      chargebackIban: Not(IsNull()),
      chargebackCreditorData: Not(IsNull()),
      chargebackOutput: IsNull(),
    };

    const entities = await this.bankTxReturnRepo.find({
      where: [
        {
          ...baseWhere,
          userData: {
            kycStatus: In([KycStatus.NA, KycStatus.COMPLETED]),
            status: Not(UserDataStatus.BLOCKED),
            riskStatus: In([RiskStatus.NA, RiskStatus.RELEASED]),
          },
        },
      ],
      relations: { bankTx: true, userData: true },
    });

    for (const entity of entities) {
      try {
        if (
          Util.includesSameName(entity.userData.verifiedName, entity.creditorData.name) ||
          Util.includesSameName(entity.userData.completeName, entity.creditorData.name) ||
          (!entity.userData.verifiedName && !entity.userData.completeName)
        )
          await this.refundBankTx(entity, {
            chargebackAllowedDate: new Date(),
            chargebackAllowedBy: 'API',
          });
      } catch (e) {
        this.logger.error(`Failed to chargeback bank-tx-return ${entity.id}:`, e);
      }
    }
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

    entity = this.bankTxReturnRepo.create({
      bankTx,
      transaction,
      userData: bankTx.transaction.userData,
      inputAmount: bankTx.amount,
      inputAsset: bankTx.currency,
    });

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
      chargebackCurrency: dto.chargebackAsset,
      chargebackAllowedDate: dto.chargebackAllowedDate,
      chargebackAllowedBy: dto.chargebackAllowedBy,
    });
  }

  async refundBankTx(bankTxReturn: BankTxReturn, dto: BankTxRefund): Promise<void> {
    const chargebackAmount = dto.chargebackAmount ?? bankTxReturn.chargebackAmount;
    const chargebackReferenceAmount = dto.chargebackReferenceAmount ?? bankTxReturn.chargebackReferenceAmount;
    const chargebackIban = dto.refundIban ?? bankTxReturn.chargebackIban;
    const chargebackAsset = dto.chargebackCurrency ?? bankTxReturn.chargebackAsset;

    if (!chargebackIban) throw new BadRequestException('You have to define a chargebackIban');

    TransactionUtilService.validateRefund(bankTxReturn, {
      refundIban: chargebackIban,
      chargebackAmount,
      chargebackReferenceAmount: dto.chargebackReferenceAmount,
      assetMismatch: chargebackAsset && chargebackAsset !== bankTxReturn.inputAsset,
    });

    if (
      !(await this.transactionUtilService.validateChargebackIban(
        chargebackIban,
        chargebackIban !== bankTxReturn.bankTx.iban,
      ))
    )
      throw new BadRequestException('IBAN not valid or BIC not available');

    const creditorData = bankTxReturn.creditorData ?? dto.creditorData;
    if ((dto.chargebackAllowedDate || dto.chargebackAllowedDateUser) && !creditorData)
      throw new BadRequestException('Creditor data is required for chargeback');

    // Read before chargebackFillUp assigns over the entity below, so the condition keeps seeing
    // pre-call state whatever that assignment does to chargebackAsset.
    const createsChargebackOutput = Boolean(
      dto.chargebackAllowedDate && chargebackAmount && (dto.chargebackCurrency || bankTxReturn.chargebackAsset),
    );

    await this.bankTxReturnRepo.manager.transaction(async (manager) => {
      // Built before chargebackFillUp assigns over the entity, so it pins the state this refund was
      // validated against rather than the state it is about to write.
      const claimWhere = BankTxReturnService.refundClaimWhere(bankTxReturn);
      const [, update] = bankTxReturn.chargebackFillUp(
        chargebackIban,
        chargebackReferenceAmount,
        chargebackAmount,
        chargebackAsset,
        dto.chargebackAllowedDate,
        dto.chargebackAllowedDateUser,
        dto.chargebackAllowedBy,
        bankTxReturn.chargebackBankRemittanceInfo,
        creditorData,
      );
      const claim = await manager.update(BankTxReturn, claimWhere, update);
      if (claim.affected !== 1) throw new ConflictException('BankTxReturn refund state changed concurrently');

      // FiatOutput.bankTxReturn is the inverse side of BankTxReturn.chargebackOutput, so saving it
      // writes chargebackOutputId onto this row as a side effect. That FK and the state write above
      // must commit together: chargebackTx selects on `chargebackOutput: IsNull()` and
      // validateRefund rejects on the same column, so a row carrying one without the other is
      // neither retried nor refundable by hand.
      //
      // It must also come after the claim, not before: the claim pins chargebackOutput to IsNull(),
      // so writing the FK first would make the claim match nothing and conflict with this very
      // transaction — the bug #4656 fixed on the BuyCrypto side.
      if (createsChargebackOutput) {
        bankTxReturn.chargebackOutput = await this.fiatOutputService.createInternal(
          FiatOutputType.BANK_TX_RETURN,
          { bankTxReturn },
          bankTxReturn.id,
          false,
          {
            iban: chargebackIban,
            amount: chargebackAmount,
            currency: chargebackAsset,
            ...creditorData,
          },
          manager,
        );
      }
    });
  }
}
