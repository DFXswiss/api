import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { isLiechtensteinBankHoliday } from 'src/config/liechtenstein-bank-holiday.config';
import { Pain001Payment } from 'src/integration/bank/services/iso20022.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { AzureStorageService } from 'src/integration/infrastructure/azure-storage.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTx, BankTxType, BankTxTypeUnassigned } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { Bank } from '../bank/bank/bank.entity';
import { BankService } from '../bank/bank/bank.service';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { VirtualIbanService } from '../bank/virtual-iban/virtual-iban.service';
import { LogService } from '../log/log.service';
import { Ep2ReportService } from './ep2-report.service';
import { FiatOutput, FiatOutputType } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputJobService {
  private readonly logger = new DfxLogger(FiatOutputJobService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly ep2ReportService: Ep2ReportService,
    private readonly bankService: BankService,
    private readonly countryService: CountryService,
    private readonly assetService: AssetService,
    private readonly logService: LogService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly yapealService: YapealService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.FIAT_OUTPUT, timeout: 1800 })
  async fillFiatOutput() {
    await this.assignBankAccount();
    await this.setReadyDate();
    await this.createBatches();
    await this.checkTransmission();
    await this.transmitYapealPayments();
    await this.searchOutgoingBankTx();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.FIAT_OUTPUT, timeout: 1800 })
  async generateReports() {
    const entities = await this.fiatOutputRepo.find({
      where: { reportCreated: false, isComplete: true },
      relations: {
        buyFiats: { sell: true, transaction: { userData: true }, cryptoInput: { paymentLinkPayment: { link: true } } },
      },
    });

    for (const entity of entities) {
      try {
        const buyFiat = entity.buyFiats[0];

        const report = this.ep2ReportService.generateReport(entity);
        const container = buyFiat.userData.paymentLinksConfigObj.ep2ReportContainer;
        const routeId = buyFiat.paymentLinkPayment.link.linkConfigObj?.payoutRouteId ?? buyFiat.sell.id;
        const fileName = `settlement_${Util.isoDateTime(entity.created)}_${routeId}.ep2`;

        await new AzureStorageService(container).uploadBlob(fileName, Buffer.from(report), 'text/xml');

        await this.fiatOutputRepo.update(entity.id, { reportCreated: true });
      } catch (e) {
        this.logger.error(`Failed to generate EP2 report for fiat output ${entity.id}:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  private async getMatchingBankTx(entity: FiatOutput): Promise<BankTx> {
    if (!entity.remittanceInfo) return undefined;

    return this.bankTxService.getBankTxByRemittanceInfo(entity.remittanceInfo);
  }

  private async getPayoutAccount(entity: FiatOutput, country: Country): Promise<{ accountIban: string; bank: Bank }> {
    // use virtual IBAN if existing
    if (entity.userData && [FiatOutputType.BUY_FIAT, FiatOutputType.BUY_CRYPTO_FAIL].includes(entity.type)) {
      const virtualIban = await this.virtualIbanService.getActiveForUserAndCurrency(
        entity.userData,
        entity.bankAccountCurrency,
      );

      if (virtualIban?.bank?.send && virtualIban.bank.isCountryEnabled(country))
        return { accountIban: virtualIban.iban, bank: virtualIban.bank };
    }

    // fallback to standard bank account selection
    const bank = await this.bankService.getSenderBank(entity.bankAccountCurrency);
    return bank?.isCountryEnabled(country)
      ? { accountIban: bank.iban, bank }
      : { accountIban: undefined, bank: undefined };
  }

  private async assignBankAccount(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_ASSIGN_BANK_ACCOUNT)) return;

    const request: FindOptionsWhere<FiatOutput> = {
      valutaDate: IsNull(),
      isComplete: false,
      type: In([FiatOutputType.BUY_CRYPTO_FAIL, FiatOutputType.BUY_FIAT, FiatOutputType.BANK_TX_RETURN]),
    };

    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...request, originEntityId: IsNull() },
        { ...request, accountIban: IsNull() },
      ],
      relations: {
        buyCrypto: { bankTx: true, transaction: { userData: true } },
        buyFiats: { sell: true, transaction: { userData: true } },
        bankTxReturn: { bankTx: true },
      },
    });

    for (const entity of entities) {
      try {
        if (!entity.buyFiats?.length && !entity.buyCrypto && !entity.bankTxReturn) continue;

        const country = await this.countryService.getCountryWithSymbol(entity.ibanCountry);

        const { accountIban, bank } = await this.getPayoutAccount(entity, country);

        await this.fiatOutputRepo.update(entity.id, {
          originEntityId: entity.originEntity?.id,
          accountIban,
          bank,
        });
      } catch (e) {
        this.logger.error(`Error in fillPreValutaDate fiatOutput: ${entity.id}:`, e);
      }
    }
  }

  private async setReadyDate(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_READY_DATE)) return;

    const entities = await this.fiatOutputRepo.find({
      where: { valutaDate: Not(IsNull()), amount: Not(IsNull()), isComplete: false },
      relations: {
        buyCrypto: { transaction: { user: true, userData: true } },
        buyFiats: { sell: true, cryptoInput: true, transaction: { user: true, userData: true } },
        bankTx: true,
        bankTxReturn: { userData: true },
      },
    });

    if (entities.every((f) => f.isReadyDate)) return;

    const groupedEntities = Util.groupByAccessor(entities, (f) => f.sourceIban);

    const assets = await this.assetService
      .getAssetsWith({ bank: true, balance: true })
      .then((assets) => assets.filter((a) => a.type === AssetType.CUSTODY && a.bank));

    for (const accountIbanGroup of groupedEntities.values()) {
      let updatedFiatOutputAmount = 0;

      const sortedEntities: FiatOutput[] = accountIbanGroup.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.bankAmount - b.bankAmount;
      });

      const pendingFiatOutputs = accountIbanGroup.filter(
        (tx) =>
          tx.isReadyDate && !tx.bankTx && (!tx.bank || tx.bank.name !== IbanBankName.YAPEAL || !tx.isTransmittedDate),
      );
      const pendingBalance = Util.sumObjValue(pendingFiatOutputs, 'bankAmount');

      for (const entity of sortedEntities.filter((e) => !e.isReadyDate)) {
        try {
          if (
            (entity.user?.isBlockedOrDeleted || entity.userData?.isBlocked) &&
            entity.type === FiatOutputType.BUY_FIAT
          )
            throw new Error('Payout stopped for blocked user');
          if (entity.originEntity && (!entity.originEntity.amountInChf || !entity.originEntity.amountInEur)) continue;

          const asset = assets.find((a) => a.bank.iban === entity.sourceIban);

          const availableBalance =
            asset.balance.amount - pendingBalance - updatedFiatOutputAmount - Config.liquidityManagement.bankMinBalance;

          if (availableBalance > entity.bankAmount) {
            updatedFiatOutputAmount += entity.bankAmount;
            const ibanCountry = entity.iban.substring(0, 2);

            if (
              !entity.buyFiats.length ||
              (entity.buyFiats?.[0]?.cryptoInput.isConfirmed &&
                entity.buyFiats?.[0]?.cryptoInput.asset.blockchain &&
                (asset.name !== 'CHF' || ['CH', 'LI'].includes(ibanCountry)))
            ) {
              if (ibanCountry === 'LI' && entity.type === FiatOutputType.LIQ_MANAGEMENT) {
                if (
                  isLiechtensteinBankHoliday() ||
                  (isLiechtensteinBankHoliday(Util.daysAfter(1)) && new Date().getHours() >= 16)
                ) {
                  this.logger.verbose(`FiatOutput ${entity.id} blocked: Liechtenstein bank holiday`);
                  continue;
                }
              }

              await this.fiatOutputRepo.update(entity.id, { isReadyDate: new Date() });
              this.logger.info(
                `FiatOutput ${entity.id} ready: LiqBalance ${asset.balance.amount} ${
                  asset.name
                }, pendingFiatOutputs ${pendingFiatOutputs
                  .map((f) => f.id)
                  .join(';')}, updatedFiatOutputAmount: ${updatedFiatOutputAmount}`,
              );
            }
          } else {
            break;
          }
        } catch (e) {
          this.logger.error(`Failed to set isReadyDate in fiat-output ${entity.id}:`, e);
        }
      }
    }
  }

  private async createBatches(): Promise<void> {
    if (
      DisabledProcess(Process.FIAT_OUTPUT_BATCH_ID_UPDATE_JOB) ||
      DisabledProcess(Process.FIAT_OUTPUT_BATCH_ID_UPDATE)
    )
      return;

    const entities = await this.fiatOutputRepo.findBy({
      amount: Not(IsNull()),
      isReadyDate: Not(IsNull()),
      batchId: IsNull(),
      isComplete: false,
      bank: { name: Not(IbanBankName.YAPEAL) },
    });

    let currentBatch: FiatOutput[] = [];
    let currentBatchId = (await this.getLastBatchId()) + 1;
    const batches: FiatOutput[] = [];

    for (const entity of entities) {
      try {
        const currentBatchAmount = currentBatch.reduce((sum, tx) => sum + tx.amount, 0);

        if (
          currentBatch.length &&
          currentBatchAmount + entity.amount >= Config.liquidityManagement.fiatOutput.batchAmountLimit
        ) {
          currentBatch.forEach((fiatOutput) => fiatOutput.setBatch(currentBatchId, currentBatchAmount * 100));
          batches.push(...currentBatch);

          currentBatchId += 1;
          currentBatch = [entity];
        } else {
          currentBatch.push(entity);
        }
      } catch (e) {
        this.logger.error(`Error in createBatches fiatOutput ${entity.id}:`, e);
      }
    }

    currentBatch.forEach((fiatOutput) =>
      fiatOutput.setBatch(currentBatchId, currentBatch.reduce((sum, tx) => sum + tx.amount, 0) * 100),
    );
    batches.push(...currentBatch);

    await this.fiatOutputRepo.save(batches);
  }

  private async checkTransmission(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_TRANSMISSION_CHECK)) return;

    const entities = await this.fiatOutputRepo.find({
      where: { batchId: Not(IsNull()), isTransmittedDate: IsNull(), isComplete: false },
      order: { batchId: 'ASC' },
    });

    const groupedEntities = Util.groupBy(entities, 'batchId');

    for (const batchIdGroup of groupedEntities.values()) {
      const logEntities = await this.logService.getBankLog(`MSG-${batchIdGroup[0].batchId}-`);
      if (!logEntities) continue;

      for (const entity of batchIdGroup) {
        await this.fiatOutputRepo.update(entity.id, {
          isTransmittedDate: new Date(),
          isConfirmedDate: new Date(),
          isApprovedDate: new Date(),
        });
      }
    }
  }

  private async transmitYapealPayments(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_YAPEAL_TRANSMISSION)) return;
    if (!this.yapealService.isAvailable()) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        isReadyDate: Not(IsNull()),
        isTransmittedDate: IsNull(),
        yapealMsgId: IsNull(),
        isComplete: false,
        bank: { name: IbanBankName.YAPEAL },
      },
    });

    for (const entity of entities) {
      try {
        const msgId = `YAPEAL-${entity.id}-${Date.now()}`;
        const endToEndId = entity.endToEndId ?? `E2E-${entity.id}`;

        const payment: Pain001Payment = {
          messageId: msgId,
          endToEndId,
          amount: entity.amount,
          currency: entity.currency as 'CHF' | 'EUR',
          debtor: {
            name: Config.bank.dfxAddress.name,
            country: 'CH',
            iban: entity.accountIban,
          },
          creditor: {
            name: entity.name,
            address: entity.address,
            houseNumber: entity.houseNumber,
            zip: entity.zip,
            city: entity.city,
            country: entity.country,
            iban: entity.iban,
            bic: entity.bic,
          },
          remittanceInfo: entity.remittanceInfo,
        };

        await this.yapealService.sendPayment(payment);
        await this.fiatOutputRepo.update(entity.id, {
          yapealMsgId: msgId,
          endToEndId,
          isTransmittedDate: new Date(),
          isApprovedDate: new Date(),
        });
      } catch (e) {
        this.logger.error(`Failed to transmit YAPEAL payment for fiat output ${entity.id}:`, e);
      }
    }
  }

  private async searchOutgoingBankTx(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_BANK_TX_SEARCH)) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        amount: Not(IsNull()),
        isComplete: false,
        bankTx: { id: IsNull() },
        isReadyDate: Not(IsNull()),
      },
      relations: { bankTx: { transaction: true }, bankTxReturn: true, bankTxRepeat: true },
    });

    for (const entity of entities) {
      try {
        const bankTx = await this.getMatchingBankTx(entity);
        if (!bankTx || entity.isReadyDate > bankTx.created) continue;

        const updateData: Partial<FiatOutput> = {
          bankTx,
          outputDate: bankTx.created,
          isComplete: true,
        };

        if (entity.yapealMsgId && !entity.isConfirmedDate) {
          updateData.isConfirmedDate = bankTx.created;
        }

        await this.fiatOutputRepo.update(entity.id, updateData);

        if (entity.type === FiatOutputType.BANK_TX_RETURN)
          await this.bankTxReturnService.updateInternal(entity.bankTxReturn, { chargebackBankTx: bankTx });

        if (entity.type === FiatOutputType.BANK_TX_REPEAT)
          await this.bankTxRepeatService.updateInternal(entity.bankTxRepeat, { chargebackBankTx: bankTx });

        if (!bankTx.type || BankTxTypeUnassigned(bankTx.type)) await this.setBankTxType(entity.type, bankTx);
      } catch (e) {
        this.logger.error(`Error in bankTx search fiatOutput ${entity.id}:`, e);
      }
    }
  }

  private async getLastBatchId(): Promise<number> {
    return this.fiatOutputRepo
      .findOne({ order: { batchId: 'DESC' }, where: { batchId: Not(IsNull()) } })
      .then((u) => u?.batchId ?? 0);
  }

  private async setBankTxType(type: FiatOutputType, bankTx: BankTx): Promise<BankTx> {
    switch (type) {
      case FiatOutputType.BUY_CRYPTO_FAIL:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BUY_CRYPTO_RETURN });

      case FiatOutputType.BUY_FIAT:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BUY_FIAT });

      case FiatOutputType.BANK_TX_REPEAT:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BANK_TX_REPEAT_CHARGEBACK });

      case FiatOutputType.BANK_TX_RETURN:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BANK_TX_RETURN_CHARGEBACK });
    }
  }
}
