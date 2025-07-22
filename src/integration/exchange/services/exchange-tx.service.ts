import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PriceCurrency, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsRelations, In, MoreThan, MoreThanOrEqual } from 'typeorm';
import { ExchangeTxDto } from '../dto/exchange-tx.dto';
import { ExchangeSync, ExchangeSyncs, ExchangeTx, ExchangeTxType } from '../entities/exchange-tx.entity';
import { ExchangeName } from '../enums/exchange.enum';
import { ExchangeTxMapper } from '../mappers/exchange-tx.mapper';
import { ExchangeTxRepository } from '../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from './exchange-registry.service';

@Injectable()
export class ExchangeTxService {
  private readonly logger = new DfxLogger(ExchangeTxService);

  constructor(
    private readonly exchangeTxRepo: ExchangeTxRepository,
    private readonly registryService: ExchangeRegistryService,
    private readonly assetService: AssetService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
  ) {}

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.EXCHANGE_TX_SYNC, timeout: 1800 })
  async syncExchanges() {
    const since = Util.minutesBefore(Config.exchangeTxSyncLimit);
    const transactions = await Promise.all(ExchangeSyncs.map((s) => this.getTransactionsFor(s, since))).then((tx) =>
      tx.flat(),
    );

    // sort by date
    transactions.sort((a, b) => a.externalCreated.getTime() - b.externalCreated.getTime());

    for (const transaction of transactions) {
      let entity = await this.exchangeTxRepo.findOneBy({
        exchange: transaction.exchange,
        externalId: transaction.externalId,
        type: transaction.type,
      });
      entity = entity ? Object.assign(entity, transaction) : this.exchangeTxRepo.create(transaction);

      if (entity.feeAmount && !entity.feeAmountChf) {
        if (entity.feeCurrency === 'CHF') {
          entity.feeAmountChf = entity.feeAmount;
        } else {
          const feeAsset =
            (await this.fiatService.getFiatByName(entity.feeCurrency)) ??
            (await this.assetService.getAssetByQuery({
              blockchain: undefined,
              type: undefined,
              name: entity.feeCurrency,
            }));
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, true);

          entity.feeAmountChf = price.convert(entity.feeAmount, Config.defaultVolumeDecimal);
        }
      }

      if (entity.amount && !entity.amountChf) {
        const currencyName = entity.type === ExchangeTxType.TRADE ? entity.symbol.split('/')[0] : entity.currency;

        if (currencyName === 'CHF') {
          entity.amountChf = entity.amount;
        } else {
          const currency =
            (await this.fiatService.getFiatByName(currencyName)) ??
            (await this.assetService.getAssetByQuery({
              blockchain: undefined,
              type: undefined,
              name: currencyName,
            }));
          const priceChf = await this.pricingService.getPrice(currency, PriceCurrency.CHF, true);

          entity.amountChf = priceChf.convert(entity.amount, Config.defaultVolumeDecimal);
        }
      }

      await this.exchangeTxRepo.save(entity);
    }
  }

  async getExchangeTx(from: Date, relations?: FindOptionsRelations<ExchangeTx>): Promise<ExchangeTx[]> {
    return this.exchangeTxRepo.find({ where: { created: MoreThan(from) }, relations });
  }

  async getLastExchangeTx(exchange: ExchangeName, relations?: FindOptionsRelations<ExchangeTx>): Promise<ExchangeTx> {
    return this.exchangeTxRepo.findOne({ where: { exchange, status: 'ok' }, order: { id: 'DESC' }, relations });
  }

  async getRecentExchangeTx(minId: number, exchange: ExchangeName, types: ExchangeTxType[]): Promise<ExchangeTx[]> {
    return this.exchangeTxRepo.findBy({
      id: minId ? MoreThanOrEqual(minId) : undefined,
      type: In(types),
      exchange,
      created: !minId ? MoreThan(Util.daysBefore(21)) : undefined,
    });
  }

  private async getTransactionsFor(sync: ExchangeSync, since: Date): Promise<ExchangeTxDto[]> {
    try {
      const exchangeService = this.registryService.get(sync.exchange);

      const tokens = sync.tokens ?? (await this.assetService.getAssetsUsedOn(sync.exchange));

      // replace invalid tokens
      for (const [index, token] of tokens.entries()) {
        const replacement = sync.tokenReplacements.find(([from, _]) => token === from);
        if (replacement) tokens[index] = replacement[1];
      }

      const transactions: ExchangeTxDto[] = [];

      for (const token of tokens) {
        // deposits
        transactions.push(
          ...(await exchangeService
            .getDeposits(token, since)
            .then((d) => ExchangeTxMapper.mapDeposits(d, sync.exchange))),
        );

        // withdrawals
        transactions.push(
          ...(await exchangeService
            .getWithdrawals(token, since)
            .then((w) => ExchangeTxMapper.mapWithdrawals(w, sync.exchange))),
        );
      }

      // trades
      const tradePairs = sync.tradeTokens
        ? sync.tradeTokens
            .reduce((prev, curr) => {
              prev.push(tokens.filter((t) => t !== curr).map((t) => [curr, t]));
              return prev;
            }, [])
            .flat(1)
            .filter((p, i, l) => l.findIndex((p1) => p.every((t) => p1.includes(t))) === i)
        : [[undefined, undefined]];

      for (const [from, to] of tradePairs) {
        try {
          const txs = await exchangeService
            .getTrades(from, to, since)
            .then((t) => ExchangeTxMapper.mapTrades(t, sync.exchange));
          transactions.push(...txs);
        } catch (e) {
          if (!e.message?.includes('not supported')) throw e;
        }
      }

      return transactions;
    } catch (e) {
      this.logger.error(`Failed to synchronize transactions from ${sync.exchange}:`, e);
    }

    return [];
  }
}
