import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AzureStorageService } from 'src/integration/infrastructure/azure-storage.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { In, IsNull, Not } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
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
    await this.fillPreValutaDate();
    await this.fillIsReadyDate();
    await this.setBatchId();
    await this.setDates();
    await this.bankTxSearch();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.FIAT_OUTPUT, timeout: 1800 })
  async generateReports() {
    const entities = await this.fiatOutputRepo.find({
      where: { reportCreated: false, isComplete: true },
      relations: {
        buyFiats: { transaction: { userData: true }, cryptoInput: { paymentLinkPayment: { link: true } } },
      },
    });

    for (const entity of entities) {
      try {
        const report = this.ep2ReportService.generateReport(entity);
        const container = entity.buyFiats[0].userData.paymentLinksConfigObj.ep2ReportContainer;
        const fileName = `settlement_${Util.isoDateTime(entity.created)}.ep2`;

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

  private async fillPreValutaDate(): Promise<void> {
    const entities = await this.fiatOutputRepo.find({
      where: { valutaDate: IsNull(), isComplete: false },
      relations: { buyCrypto: true, buyFiats: { sell: true } },
    });

    for (const entity of entities) {
      try {
        if (!entity.buyFiats.length && !entity.buyCrypto) continue;

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
        this.logger.error(`Error in fiatOutput fillPreValutaDate job: ${entity.id}`, e);
      }
    }
  }

  private async fillIsReadyDate(): Promise<void> {
    const entities = await this.fiatOutputRepo
      .find({
        where: { valutaDate: Not(IsNull()), amount: Not(IsNull()), isComplete: false },
        relations: { buyCrypto: true, buyFiats: { sell: true }, bankTx: true },
      })
      .then((f) =>
        f.sort((a, b) => {
          if (a.accountIban !== b.accountIban) return a.accountIban.localeCompare(b.accountIban);
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.amount - b.amount;
        }),
      );

    const groupedEntities = entities.reduce((map, tx) => {
      if (!map.has(tx.accountIban)) map.set(tx.accountIban, []);
      map.get(tx.accountIban)!.push(tx);
      return map;
    }, new Map<string, FiatOutput[]>());

    const sortedEntities = Array.from(groupedEntities.values()).map((group) =>
      group.sort((a, b) => {
        if (a.accountIban !== b.accountIban) return a.accountIban.localeCompare(b.accountIban);
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.amount - b.amount;
      }),
    );

    const assets = await this.assetService
      .getAllAssets()
      .then((assets) => assets.filter((a) => a.type === AssetType.CUSTODY && a.bank));
    const liqBalances = await this.liquidityManagementBalanceService.getAllLiqBalancesForAssets(
      assets.map((a) => a.id),
    );

    for (const accountIbanGroup of sortedEntities) {
      let updatedFiatOutputs = 0;

      for (const entity of accountIbanGroup.filter((e) => !e.isReadyDate)) {
        try {
          const liqBalance = liqBalances.find((l) => l.asset.bank.iban === entity.accountIban);
          const pendingBalance = accountIbanGroup.reduce(
            (sum, tx) => sum + (tx.isReadyDate && !tx.bankTx ? tx.amount : 0),
            0,
          );
          const availableBalance =
            liqBalance.amount - pendingBalance - updatedFiatOutputs - Config.processing.fiatOutput.bankPuffer;

          if (availableBalance > entity.amount) {
            updatedFiatOutputs += entity.amount;
            const ibanCountry = entity.iban.substring(0, 2);

            if (
              !entity.buyFiats.length ||
              (entity.buyFiats?.[0]?.cryptoInput.isConfirmed &&
                entity.buyFiats?.[0]?.cryptoInput.asset.blockchain &&
                (liqBalance.asset.name !== 'CHF' || ['CH', 'LI'].includes(ibanCountry)))
            )
              await this.fiatOutputRepo.update(entity.id, { isReadyDate: new Date() });
          }
        } catch (e) {
          this.logger.error(`Error in fiatOutput fillUp job: ${entity.id}`, e);
        }
      }
    }
  }

  private async setBatchId(): Promise<void> {
    const entities = await this.fiatOutputRepo.find({
      where: { isReadyDate: Not(IsNull()), batchId: IsNull(), isComplete: false },
      order: { accountIban: 'ASC', id: 'ASC' },
    });

    let currentBatch: FiatOutput[] = [];
    for (const entity of entities) {
      if (!currentBatch.length) currentBatch.push(entity);

      const currentBatchAmount = currentBatch.reduce((sum, tx) => sum + tx.amount, 0);

      if (
        currentBatch[0].accountIban !== entity.accountIban ||
        currentBatchAmount + entity.amount > Config.processing.fiatOutput.batchAmountLimit
      ) {
        await this.fiatOutputRepo.update(
          { id: In(currentBatch.map((f) => f.id)) },
          { batchId: (await this.getLastBatchId()) + 1, batchAmount: currentBatchAmount * 100 },
        );
        currentBatch = [entity];
      } else {
        currentBatch.push(entity);
      }
    }
  }

  private async setDates(): Promise<void> {
    const entities = await this.fiatOutputRepo.find({
      where: { batchId: Not(IsNull()), isTransmittedDate: IsNull(), isComplete: false },
    });

    const logEntities = await this.logService.getBankLogs(entities.map((f) => `MSG-${f.batchId}-`));

    for (const entity of entities) {
      if (!logEntities.some((l) => l.message.includes(`MSG-${entity.batchId}-`))) continue;

      await this.fiatOutputRepo.update(entity.id, {
        isTransmittedDate: new Date(),
        isConfirmedDate: new Date(),
        isApprovedDate: new Date(),
      });
    }
  }

  private async bankTxSearch(): Promise<void> {
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

        await this.fiatOutputRepo.update(entity.id, { bankTx, outputDate: bankTx.created });
      } catch (e) {
        this.logger.error(`Error in fiatOutput bankTx search job: ${entity.id}`, e);
      }
    }
  }

  private async getLastBatchId(): Promise<number> {
    return this.fiatOutputRepo.findOne({ order: { batchId: 'DESC' } }).then((u) => u.batchId);
  }
}
