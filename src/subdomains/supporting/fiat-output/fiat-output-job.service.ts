import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AzureStorageService } from 'src/integration/infrastructure/azure-storage.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { BankTx, BankTxType } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from '../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../bank/bank/bank.service';
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
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly assetService: AssetService,
    private readonly logService: LogService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.FIAT_OUTPUT, timeout: 1800 })
  async fillFiatOutput() {
    await this.assignBankAccount();
    await this.setReadyDate();
    await this.createBatches();
    await this.checkTransmission();
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
        const fileName = `settlement-${routeId}_${Util.isoDateTime(entity.created)}.ep2`;

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

  private async assignBankAccount(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_ASSIGN_BANK_ACCOUNT)) return;

    const request: FindOptionsWhere<FiatOutput> = {
      valutaDate: IsNull(),
      isComplete: false,
      type: In([FiatOutputType.BUY_CRYPTO_FAIL, FiatOutputType.BUY_FIAT]),
    };

    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...request, originEntityId: IsNull() },
        { ...request, accountIban: IsNull() },
      ],
      relations: { buyCrypto: true, buyFiats: { sell: true } },
    });

    for (const entity of entities) {
      try {
        if (!entity.buyFiats?.length && !entity.buyCrypto) continue;

        const ibanCountry = (entity.buyCrypto?.chargebackIban ?? entity.buyFiats?.[0]?.sell?.iban)?.substring(0, 2);
        const country = await this.countryService.getCountryWithSymbol(ibanCountry);
        const currency = ['LI', 'CH'].includes(ibanCountry)
          ? 'CHF'
          : entity.buyCrypto?.bankTx?.currency ?? entity.buyFiats?.[0]?.sell?.fiat?.name;

        const bank = await this.bankService.getSenderBank(currency);

        await this.fiatOutputRepo.update(entity.id, {
          originEntityId: entity.type === FiatOutputType.BUY_FIAT ? entity.buyFiats[0].id : entity.buyCrypto.id,
          accountIban: country.maerkiBaumannEnable ? bank?.iban : undefined,
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
      relations: { buyCrypto: true, buyFiats: { sell: true }, bankTx: true },
    });

    const groupedEntities = Util.groupBy(entities, 'accountIban');

    const assets = await this.assetService
      .getAllAssets()
      .then((assets) => assets.filter((a) => a.type === AssetType.CUSTODY && a.bank));
    const liqBalances = await this.liquidityManagementBalanceService.getAllLiqBalancesForAssets(
      assets.map((a) => a.id),
    );

    for (const accountIbanGroup of groupedEntities.values()) {
      let updatedFiatOutputAmount = 0;

      const sortedEntities: FiatOutput[] = accountIbanGroup.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.amount - b.amount;
      });

      const pendingBalance = accountIbanGroup.reduce(
        (sum, tx) => sum + (tx.isReadyDate && !tx.bankTx ? tx.amount : 0),
        0,
      );

      for (const entity of sortedEntities.filter((e) => !e.isReadyDate)) {
        try {
          const liqBalance = liqBalances.find((l) => l.asset.bank.iban === entity.accountIban);

          const availableBalance =
            liqBalance.amount - pendingBalance - updatedFiatOutputAmount - Config.liquidityManagement.bankMinBalance;

          if (availableBalance > entity.amount) {
            updatedFiatOutputAmount += entity.amount;
            const ibanCountry = entity.iban.substring(0, 2);

            if (
              !entity.buyFiats.length ||
              (entity.buyFiats?.[0]?.cryptoInput.isConfirmed &&
                entity.buyFiats?.[0]?.cryptoInput.asset.blockchain &&
                (liqBalance.asset.name !== 'CHF' || ['CH', 'LI'].includes(ibanCountry)))
            )
              await this.fiatOutputRepo.update(entity.id, { isReadyDate: new Date() });
          } else {
            break;
          }
        } catch (e) {
          this.logger.error(`Failed to fill up fiat-output ${entity.id}:`, e);
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

    const entities = await this.fiatOutputRepo.find({
      where: { amount: Not(IsNull()), isReadyDate: Not(IsNull()), batchId: IsNull(), isComplete: false },
      order: { accountIban: 'ASC', id: 'ASC' },
    });

    let currentBatch: FiatOutput[] = [];
    let currentBatchId = (await this.getLastBatchId()) + 1;
    const batches: FiatOutput[] = [];

    for (const entity of entities) {
      try {
        const currentBatchAmount = currentBatch.reduce((sum, tx) => sum + tx.amount, 0);

        if (
          currentBatch.length &&
          (currentBatch[0].accountIban !== entity.accountIban ||
            currentBatchAmount + entity.amount >= Config.liquidityManagement.fiatOutput.batchAmountLimit)
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

  private async searchOutgoingBankTx(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_BANK_TX_SEARCH)) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        amount: Not(IsNull()),
        isComplete: false,
        bankTx: { id: IsNull() },
        isReadyDate: Not(IsNull()),
        isTransmittedDate: Not(IsNull()),
      },
      relations: { bankTx: true },
    });

    for (const entity of entities) {
      try {
        const bankTx = await this.getMatchingBankTx(entity);
        if (!bankTx || entity.isReadyDate > bankTx.created) continue;

        await this.fiatOutputRepo.update(entity.id, { bankTx, outputDate: bankTx.created, isComplete: true });

        if (bankTx.type === BankTxType.GSHEET) await this.setBankTxType(entity.type, bankTx);
      } catch (e) {
        this.logger.error(`Error in bankTx search fiatOutput ${entity.id}:`, e);
      }
    }
  }

  private async getLastBatchId(): Promise<number> {
    return this.fiatOutputRepo
      .findOne({ order: { batchId: 'DESC' }, where: { batchId: Not(IsNull()) } })
      .then((u) => u.batchId);
  }

  private async setBankTxType(type: FiatOutputType, bankTx: BankTx): Promise<BankTx> {
    switch (type) {
      case FiatOutputType.BUY_FIAT:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BUY_FIAT });

      case FiatOutputType.BANK_TX_REPEAT:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BANK_TX_REPEAT });

      case FiatOutputType.BANK_TX_RETURN:
        return this.bankTxService.updateInternal(bankTx, { type: BankTxType.BANK_TX_RETURN });
    }
  }
}
