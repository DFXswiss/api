import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { ExchangeSyncs, ExchangeTokens, ExchangeTxDto } from '../entities/exchange-tx.entity';
import { ExchangeTxKrakenMapper } from '../mappers/exchange-tx-kraken.mapper';
import { ExchangeTxRepository } from '../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from './exchange-registry.service';

@Injectable()
export class ExchangeTxService {
  constructor(
    private readonly exchangeTxRepo: ExchangeTxRepository,
    private readonly registryService: ExchangeRegistryService,
    private readonly processService: ProcessService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async syncExchanges() {
    if (await this.processService.isDisableProcess(Process.EXCHANGE_TX_SYNC)) return;

    const since = Util.minutesBefore(Config.exchangeTxSyncLimit);

    for (const exchange of ExchangeSyncs) {
      const exchangeService = this.registryService.getExchange(exchange);

      const transactions: ExchangeTxDto[] = [];

      // trades
      transactions.push(
        ...(await exchangeService
          .getTrades(undefined, undefined, since)
          .then((t) => ExchangeTxKrakenMapper.mapTrades(t, exchange))),
      );

      for (const asset of ExchangeTokens) {
        // deposits
        transactions.push(
          ...(await exchangeService
            .getDeposits(asset, since)
            .then((d) => ExchangeTxKrakenMapper.mapDeposits(d, exchange))),
        );

        // withdrawals
        transactions.push(
          ...(await exchangeService
            .getWithdrawals(asset, since)
            .then((w) => ExchangeTxKrakenMapper.mapWithdrawals(w, exchange))),
        );
      }

      // sort by date
      transactions.sort((a, b) => a.externalCreated.getTime() - b.externalCreated.getTime());

      for (const transaction of transactions) {
        let entity = await this.exchangeTxRepo.findOneBy({
          exchange: exchange,
          externalId: transaction.externalId,
          type: transaction.type,
        });
        entity = entity ? Object.assign(entity, transaction) : this.exchangeTxRepo.create(transaction);

        await this.exchangeTxRepo.save(entity);
      }
    }
  }
}
