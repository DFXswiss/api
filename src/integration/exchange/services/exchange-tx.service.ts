import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExchangeSyncs, ExchangeTokens, ExchangeTxDto } from '../entities/exchange-tx.entity';
import { ExchangeTxKrakenMapper } from '../mappers/exchange-tx-kraken.mapper';
import { ExchangeTxRepository } from '../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from './exchange-registry.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';

@Injectable()
export class ExchangeTxService {
  constructor(
    private readonly exchangeTxRepo: ExchangeTxRepository,
    private readonly registryService: ExchangeRegistryService,
  ) {}

  //*** JOBS ***//

  @Lock(1800)
  @Cron(CronExpression.EVERY_MINUTE)
  async syncExchanges() {
    for (const exchange of ExchangeSyncs) {
      const exchangeService = this.registryService.getExchange(exchange);

      const transactions: ExchangeTxDto[] = [];
      // Trades
      transactions.push(
        ...(await exchangeService.getTrades().then((t) => ExchangeTxKrakenMapper.mapTrades(t, exchange))),
      );

      for (const asset of ExchangeTokens) {
        // Deposit
        transactions.push(
          ...(await exchangeService
            .getDeposits(asset, Util.minutesBefore(120))
            .then((d) => ExchangeTxKrakenMapper.mapDeposits(d, exchange))),
        );

        // Withdrawals
        transactions.push(
          ...(await exchangeService
            .getWithdrawals(asset, Util.minutesBefore(120))
            .then((w) => ExchangeTxKrakenMapper.mapWithdrawals(w, exchange))),
        );
      }

      for (const transaction of transactions) {
        let entity = await this.exchangeTxRepo.findOne({
          where: { exchange: exchange, externalId: transaction.externalId, type: transaction.type },
        });
        entity = entity ? Object.assign(entity, transaction) : this.exchangeTxRepo.create(transaction);

        await this.exchangeTxRepo.save(entity);
      }
    }
  }
}
