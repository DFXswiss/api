import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { isLiechtensteinBankHoliday } from 'src/config/bank-holiday.config';
import { Config } from 'src/config/config';
import { OlkypayOrderStatus } from 'src/integration/bank/dto/olkypay.dto';
import { Pain001Payment } from 'src/integration/bank/services/iso20022.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { ScryptTransactionStatus } from 'src/integration/exchange/dto/scrypt.dto';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { createStorageService } from 'src/integration/infrastructure/storage/storage.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { FindOptionsWhere, In, IsNull, Like, Not } from 'typeorm';
import { BankTxRepeatService } from '../bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTx, BankTxType, BankTxTypeUnassigned } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankTxOutgoingMatchService } from '../bank-tx/bank-tx/services/bank-tx-outgoing-match.service';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { LogService } from '../log/log.service';
import { Ep2ReportService } from './ep2-report.service';
import { FiatOutputFrickService } from './fiat-output-frick.service';
import { FiatOutput, FiatOutputType } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';
import { FiatOutputService } from './fiat-output.service';

export const SCRYPT_DEPOSIT_NAME_MARKER = 'Scrypt Digital Trading';
export const SCRYPT_DEPOSIT_RETRY_INTERVAL_MS = 60 * 60 * 1000; // send and alert cadence while a deposit stays unconfirmed

@Injectable()
export class FiatOutputJobService {
  private readonly logger = new DfxLogger(FiatOutputJobService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly bankTxOutgoingMatchService: BankTxOutgoingMatchService,
    private readonly ep2ReportService: Ep2ReportService,
    private readonly countryService: CountryService,
    private readonly assetService: AssetService,
    private readonly logService: LogService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly yapealService: YapealService,
    private readonly olkypayService: OlkypayService,
    private readonly frickPayoutService: FiatOutputFrickService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly scryptService: ScryptService,
    private readonly bankService: BankService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.FIAT_OUTPUT, timeout: 1800 })
  async fillFiatOutput() {
    await this.assignBankAccount();
    await this.setReadyDate();
    await this.createBatches();
    await this.checkTransmission();
    await this.transmitYapealPayments();
    await this.transmitOlkypayPayments();
    await this.frickPayoutService.transmitPayments();
    await this.searchOutgoingBankTx();
    await this.notifyScryptDeposits();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.FIAT_OUTPUT })
  async checkOlkypayOrderStatus(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_OLKYPAY_STATUS_CHECK)) return;
    if (!this.olkypayService.isAvailable()) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        olkyOrderId: Not(IsNull()),
        isApprovedDate: IsNull(),
        isComplete: false,
      },
    });

    for (const entity of entities) {
      try {
        const order = await this.olkypayService.getPaymentOrder(+entity.olkyOrderId);

        if (order.orderStatus !== OlkypayOrderStatus.TO_VALIDATE) {
          await this.fiatOutputRepo.update(entity.id, { isApprovedDate: new Date() });
        }
      } catch (e) {
        this.logger.error(`Failed to check OLKYPAY order status for fiat output ${entity.id}:`, e);
      }
    }
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.FIAT_OUTPUT, timeout: 1800 })
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
        const fileName = `settlement_${Util.isoDateTime(entity.created)}_${entity.id}_${routeId}.ep2`;
        const reportBuffer = Buffer.from(report);

        // WORM sink: uploadWormBlob fails closed if the (runtime-resolved, per-merchant) EP2
        // container is not Object-Lock protected, so a mis-provisioned bucket never silently
        // accepts mutable GeBüV settlement records instead of throwing here.
        await createStorageService(container).uploadWormBlob(fileName, reportBuffer, 'text/xml');

        // Mark the report as created as soon as the WORM upload succeeded, so a re-run never
        // re-PUTs the same fileName into the immutable WORM bucket.
        await this.fiatOutputRepo.update(entity.id, { reportCreated: true });
      } catch (e) {
        this.logger.error(`Failed to generate EP2 report for fiat output ${entity.id}:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  private async getMatchingBankTx(entity: FiatOutput): Promise<BankTx> {
    return this.bankTxOutgoingMatchService.getUniqueOutgoingBankTx({
      // Frick's bank-echoed reference lives in frickReference - the untouched, customer-facing
      // remittanceInfo is never what the bank actually echoes back for a Frick payout. Every other
      // bank never sets frickReference, so this falls straight through to remittanceInfo for them.
      remittanceInfo: entity.frickReference ?? entity.remittanceInfo,
      endToEndId: entity.endToEndId,
      accountIban: entity.sourceIban,
      amount: entity.amount,
      currency: entity.currency,
      earliestDate: entity.isReadyDate,
    });
  }

  private async getPayoutAccount(
    entity: FiatOutput,
    country: Country,
  ): Promise<{ accountIban: string | undefined; bank: Bank | undefined }> {
    const currency = entity.currency ?? entity.bankAccountCurrency;
    return this.fiatOutputService.selectPayoutBank(currency, entity.type, entity.userData, country);
  }

  private async assignBankAccount(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_ASSIGN_BANK_ACCOUNT)) return;

    const request: FindOptionsWhere<FiatOutput> = {
      valutaDate: IsNull(),
      isComplete: false,
      type: In([FiatOutputType.BUY_CRYPTO_FAIL, FiatOutputType.BUY_FIAT, FiatOutputType.BANK_TX_RETURN]),
    };

    // OR branches: (1) missing originEntityId, (2) missing accountIban (full assignment),
    // (3) accountIban set but bank relation missing — so the repair path in the loop can run.
    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...request, originEntityId: IsNull() },
        { ...request, accountIban: IsNull() },
        { ...request, accountIban: Not(IsNull()), bank: IsNull() },
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

        if (entity.accountIban) {
          // An already-assigned account IBAN (set at creation, or a manual database assignment) must never
          // be overwritten by the automatic bank selection below - only originEntityId (and a still-missing
          // bank relation) can be repaired here.
          let bank = entity.bank;
          if (!bank) {
            bank = await this.bankService.getBankByIban(entity.accountIban);
            if (!bank)
              throw new Error(`No bank found for account IBAN ${entity.accountIban} (fiat output ${entity.id})`);
          }

          // CAS: match on the current accountIban so a concurrent write from the admin update endpoint,
          // landing between this method's snapshot read and this write, is not silently overwritten.
          await this.fiatOutputRepo.update(
            { id: entity.id, accountIban: entity.accountIban },
            { originEntityId: entity.originEntity?.id, bank },
          );
          continue;
        }

        const country = await this.countryService.getCountryWithSymbol(entity.ibanCountry);

        const { accountIban, bank } = await this.getPayoutAccount(entity, country);

        // Legacy rows may hold an empty string instead of null; match whatever value was read.
        await this.fiatOutputRepo.update(
          { id: entity.id, accountIban: entity.accountIban == null ? IsNull() : entity.accountIban },
          { originEntityId: entity.originEntity?.id, accountIban, bank },
        );
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

    let skippedFrickFiatOutputs = 0;

    for (const accountIbanGroup of groupedEntities.values()) {
      let updatedFiatOutputAmount = 0;

      const sortedEntities: FiatOutput[] = accountIbanGroup.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.bankAmount - b.bankAmount;
      });

      const pendingFiatOutputs = accountIbanGroup.filter((tx) => {
        if (!tx.isReadyDate) return false;

        switch (tx.bank?.name) {
          case IbanBankName.YAPEAL:
            return !tx.isTransmittedDate;
          case IbanBankName.FRICK:
            // A PREPARED Frick order can wait for manual approval for days. Keep its amount reserved until
            // reconciliation or a terminal failure state, otherwise later payouts can overdraw the account.
            return !this.frickPayoutService.isFrickTerminalState(tx.frickOrderStatus);
          case IbanBankName.OLKY:
            return !tx.bankTx || tx.bankTx.created > Util.minutesBefore(5);
          default:
            return !tx.bankTx;
        }
      });
      const pendingBalance = Util.sumObjValue(pendingFiatOutputs, 'bankAmount');

      for (const entity of sortedEntities.filter((e) => !e.isReadyDate)) {
        try {
          if (entity.bank?.name === IbanBankName.FRICK && !this.frickPayoutService.canCreatePayments()) {
            skippedFrickFiatOutputs++;
            continue;
          }
          if (
            (entity.user?.isBlockedOrDeleted || entity.userData?.isBlocked) &&
            entity.type === FiatOutputType.BUY_FIAT
          ) {
            const reason = entity.user?.isBlockedOrDeleted
              ? entity.user.status === UserStatus.DELETED
                ? AmlReason.USER_DELETED
                : AmlReason.USER_BLOCKED
              : AmlReason.USER_DATA_BLOCKED;

            for (const buyFiat of entity.buyFiats ?? []) {
              await this.buyFiatRepo.update(buyFiat.id, { amlCheck: CheckStatus.FAIL, amlReason: reason });
            }

            this.logger.warn(`Stopping fiat output ${entity.id}: user is blocked or deleted (${reason})`);
            continue;
          }
          if (entity.originEntity && (!entity.originEntity.amountInChf || !entity.originEntity.amountInEur)) continue;

          const asset = assets.find((a) => a.bank.iban === entity.sourceIban);

          const availableBalance =
            asset.balance.amount - pendingBalance - updatedFiatOutputAmount - Config.liquidityManagement.bankMinBalance;

          // EUR is only automated through the dedicated REST payout rails.
          if (entity.currency === 'EUR' && ![IbanBankName.OLKY, IbanBankName.FRICK].includes(entity.bank?.name))
            continue;

          if (availableBalance > entity.bankAmount) {
            updatedFiatOutputAmount += entity.bankAmount;
            const ibanCountry = entity.iban.substring(0, 2);

            if (
              !entity.buyFiats.length ||
              (entity.buyFiats?.[0]?.cryptoInput.isConfirmed && entity.buyFiats?.[0]?.cryptoInput.asset.blockchain)
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
            this.logger.verbose(
              `FiatOutput ${entity.id} blocked: required ${entity.bankAmount}, ` +
                `available ${availableBalance} ${asset.name}`,
            );
            break;
          }
        } catch (e) {
          this.logger.error(`Failed to set isReadyDate in fiat-output ${entity.id}:`, e);
        }
      }
    }

    if (skippedFrickFiatOutputs)
      this.logger.verbose(`Skipped ${skippedFrickFiatOutputs} Frick fiat outputs: payout creation disabled`);
  }

  private async createBatches(): Promise<void> {
    if (
      DisabledProcess(Process.FIAT_OUTPUT_BATCH_ID_UPDATE_JOB) ||
      DisabledProcess(Process.FIAT_OUTPUT_BATCH_ID_UPDATE)
    )
      return;

    const automatedBanks = [IbanBankName.YAPEAL, IbanBankName.OLKY, IbanBankName.FRICK];
    const entities = (
      await this.fiatOutputRepo.findBy({
        amount: Not(IsNull()),
        isReadyDate: Not(IsNull()),
        batchId: IsNull(),
        isComplete: false,
        bank: { name: Not(In(automatedBanks)) },
      })
    ).filter((entity) => !automatedBanks.includes(entity.bank?.name));

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
        const remittanceInfo = entity.remittanceInfo ?? `DFX Payout ${entity.id}`;

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
          remittanceInfo,
        };

        await this.yapealService.sendPayment(payment);
        await this.fiatOutputRepo.update(entity.id, {
          yapealMsgId: msgId,
          endToEndId,
          remittanceInfo,
          isTransmittedDate: new Date(),
          isApprovedDate: new Date(),
          ...(entity.info?.startsWith('YAPEAL error') && { info: null }),
        });
      } catch (e) {
        this.logger.error(`Failed to transmit YAPEAL payment for fiat output ${entity.id}:`, e);

        if (!entity.info) {
          const errorMsg = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e);
          await this.fiatOutputRepo.update(entity.id, { info: `YAPEAL error: ${errorMsg}`.substring(0, 256) });
        }
      }
    }
  }

  private async transmitOlkypayPayments(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_OLKYPAY_TRANSMISSION)) return;
    if (!this.olkypayService.isAvailable()) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        isReadyDate: Not(IsNull()),
        isTransmittedDate: IsNull(),
        olkyOrderId: IsNull(),
        isComplete: false,
        bank: { name: IbanBankName.OLKY },
      },
    });

    for (const entity of entities) {
      try {
        const remittanceInfo = entity.remittanceInfo ?? `DFX Payout ${entity.id}`;

        // create recipient
        const recipient = await this.olkypayService.getOrCreateRecipient({
          iban: entity.iban,
          name: entity.name,
          address: entity.address
            ? `${entity.address}${entity.houseNumber ? ' ' + entity.houseNumber : ''}`
            : undefined,
          zip: entity.zip,
          city: entity.city,
          country: entity.country,
        });

        // send payment order
        const orderResponse = await this.olkypayService.createPaymentOrder({
          clientId: +recipient.olkyPayerId,
          comment: remittanceInfo,
          currencyCode: entity.currency,
          // Olky rejects execution dates in the past on its local (CET/CEST) calendar
          executionDate: Util.isoDateInTimeZone('Europe/Luxembourg'),
          externalId: `${entity.id}`,
          nominalAmount: Math.round(entity.amount * 100), // Convert to cents
          packageNumber: `${entity.id}`,
          recidivism: false,
        });

        await this.fiatOutputRepo.update(entity.id, {
          olkyOrderId: orderResponse.id,
          isTransmittedDate: new Date(),
          remittanceInfo,
          ...(entity.info?.startsWith('OLKYPAY error') && { info: null }),
        });
      } catch (e) {
        this.logger.error(`Failed to transmit OLKYPAY payment for fiat output ${entity.id}:`, e);

        if (!entity.info) {
          const errorMsg = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e);
          await this.fiatOutputRepo.update(entity.id, { info: `OLKYPAY error: ${errorMsg}`.substring(0, 256) });
        }
      }
    }
  }

  private async searchOutgoingBankTx(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_BANK_TX_SEARCH)) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        amount: Not(IsNull()),
        isReadyDate: Not(IsNull()),
        isComplete: false,
        bankTx: { id: IsNull() },
      },
      relations: { bankTx: { transaction: true }, bankTxReturn: true, bankTxRepeat: true },
    });

    for (const entity of entities) {
      try {
        if (!entity.isReadyDate) continue;
        let bankTx = await this.getMatchingBankTx(entity);
        if (!bankTx) continue;

        if (entity.type === FiatOutputType.LIQ_MANAGEMENT && (!bankTx.type || BankTxTypeUnassigned(bankTx.type))) {
          const classifiedBankTx = await this.bankTxService.classifyKnownTypeIfAssignable(bankTx);
          if (!classifiedBankTx) continue;
          bankTx = classifiedBankTx;
        }

        const updateData: Partial<FiatOutput> = {
          bankTx,
          outputDate: bankTx.created,
          isComplete: true,
        };

        if (
          (entity.yapealMsgId || entity.olkyOrderId || entity.frickOrderId || entity.frickCustomId) &&
          !entity.isConfirmedDate
        ) {
          updateData.isConfirmedDate = bankTx.created;
        }

        if ((entity.frickOrderId || entity.frickCustomId) && !entity.isApprovedDate)
          updateData.isApprovedDate = bankTx.created;

        await this.fiatOutputRepo.update(entity.id, updateData);

        if (entity.type === FiatOutputType.BANK_TX_RETURN)
          await this.bankTxReturnService.updateInternal(entity.bankTxReturn, { chargebackBankTx: bankTx });

        if (entity.type === FiatOutputType.BANK_TX_REPEAT)
          await this.bankTxRepeatService.updateInternal(entity.bankTxRepeat, { chargebackBankTx: bankTx });

        if (entity.type !== FiatOutputType.LIQ_MANAGEMENT && (!bankTx.type || BankTxTypeUnassigned(bankTx.type)))
          await this.setBankTxType(entity.type, bankTx);
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

      case FiatOutputType.LIQ_MANAGEMENT: {
        const specificType = await this.bankTxService.getType(bankTx);
        if (specificType) return this.bankTxService.updateInternal(bankTx, { type: specificType });
      }
    }
  }

  // Last send / last alert time per fiat output, tracked separately so a fresh send never delays
  // the first rejection alert. In-memory only: a restart resets the pacing, which at worst causes
  // one extra send — assumed safe because the ClReqID stays stable per entity, so repeated
  // requests are deduplicatable on the receiving side.
  private readonly scryptDepositSendAttempts = new Map<number, Date>();
  private readonly scryptDepositAlerts = new Map<number, Date>();

  private async notifyScryptDeposits(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_SCRYPT_DEPOSIT_NOTIFY)) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        type: FiatOutputType.LIQ_MANAGEMENT,
        name: Like(`%${SCRYPT_DEPOSIT_NAME_MARKER}%`),
        isComplete: true,
        scryptDepositNotifiedDate: IsNull(),
      },
    });

    for (const entity of entities) {
      try {
        await this.notifyScryptDeposit(entity);
      } catch (e) {
        this.logger.error(`Failed to process Scrypt deposit notification for fiat output ${entity.id}:`, e);
      }
    }
  }

  private async notifyScryptDeposit(entity: FiatOutput): Promise<void> {
    // fail-closed guard against future query drift: conditions must mirror the sweep query
    if (
      entity.type !== FiatOutputType.LIQ_MANAGEMENT ||
      !entity.name?.includes(SCRYPT_DEPOSIT_NAME_MARKER) ||
      !entity.isComplete ||
      entity.scryptDepositNotifiedDate
    ) {
      return;
    }

    const reqId = entity.endToEndId ?? `DEPOSIT-${entity.id}`;

    const status = this.scryptService.getDepositStatus(reqId);
    if (status) {
      if (status.status === ScryptTransactionStatus.REJECTED || status.status === ScryptTransactionStatus.FAILED) {
        // Deliberately not terminalized: a rejected/failed deposit request needs manual intervention,
        // so the entity stays in the sweep and keeps alerting (throttled) until resolved.
        const lastAlert = this.scryptDepositAlerts.get(entity.id);
        if (lastAlert && Date.now() - lastAlert.getTime() < SCRYPT_DEPOSIT_RETRY_INTERVAL_MS) return;

        this.scryptDepositAlerts.set(entity.id, new Date());
        this.logger.error(
          `Scrypt deposit request for fiat output ${entity.id} was ${status.status}: ${status.rejectText ?? status.rejectReason ?? 'unknown reason'}`,
        );
        return;
      }

      if (status.status === ScryptTransactionStatus.COMPLETED) {
        await this.fiatOutputRepo.update(entity.id, { scryptDepositNotifiedDate: new Date() });
        this.scryptDepositSendAttempts.delete(entity.id);
        this.scryptDepositAlerts.delete(entity.id);
        return;
      }

      // Intermediate or unknown status (e.g. PendingApproval): the broker knows the request,
      // so neither mark as notified nor re-send — wait for a terminal status.
      return;
    }

    const lastAttempt = this.scryptDepositSendAttempts.get(entity.id);
    if (lastAttempt && Date.now() - lastAttempt.getTime() < SCRYPT_DEPOSIT_RETRY_INTERVAL_MS) return;

    await this.scryptService.sendDepositRequest({
      currency: entity.currency,
      amount: entity.amount,
      reqId,
      timeStamp: new Date(),
    });
    this.scryptDepositSendAttempts.set(entity.id, new Date());
  }
}
