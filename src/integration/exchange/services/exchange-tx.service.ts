import { Cron, CronExpression } from '@nestjs/schedule';
import { ExchangeTxTransactionDto } from '../dto/exchange-tx-transaction.dto';
import { ExchangeSyncs, ExchangeToken } from '../entities/exchange-tx.entity';
import { ExchangeTxMapper } from '../mappers/exchange-tx.mapper';
import { ExchangeTxRepository } from '../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from './exchange-registry.service';
import { Lock } from 'src/shared/utils/lock';

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
      const fromDate = new Date(new Date().getTime() - 3600000);

      // Trades
      const trades = await this.registryService
        .getExchange(exchange)
        .getTrades()
        .then((t) => ExchangeTxMapper.getTrades(t, exchange));

      const transactionArray: ExchangeTxTransactionDto[][] = [];

      for (const asset of ExchangeToken) {
        // Deposit
        transactionArray.push(
          await this.registryService
            .getExchange(exchange)
            .getDeposits(asset, fromDate)
            .then((d) => ExchangeTxMapper.getDeposits(d, exchange)),
        );

        // Withdrawals
        transactionArray.push(
          await this.registryService
            .getExchange(exchange)
            .getWithdrawals(asset, fromDate)
            .then((w) => ExchangeTxMapper.getWithdrawals(w, exchange)),
        );
      }

      const transactions: ExchangeTxTransactionDto[] = [
        trades,
        transactionArray.reduce((prev, curr) => prev.concat(curr), []),
      ].reduce((prev, curr) => prev.concat(curr), []);

      for (const transaction of transactions) {
        const existing = await this.exchangeTxRepo.find({
          where: { exchange: exchange, externalId: transaction.externalId },
        });
        if (existing) continue;

        const entity = this.exchangeTxRepo.create(transaction);

        this.exchangeTxRepo.save(entity);
      }
    }
  }
}
