import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { In, MoreThan } from 'typeorm';
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
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async syncExchanges() {
    if (DisabledProcess(Process.EXCHANGE_TX_SYNC)) return;

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

      await this.exchangeTxRepo.save(entity);
    }
  }

  async getRecentExchangeTx(
    exchange: ExchangeName,
    types: ExchangeTxType[],
    start = Util.daysBefore(21),
  ): Promise<ExchangeTx[]> {
    return this.exchangeTxRepo.findBy({ type: In(types), exchange, created: MoreThan(start) });
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
