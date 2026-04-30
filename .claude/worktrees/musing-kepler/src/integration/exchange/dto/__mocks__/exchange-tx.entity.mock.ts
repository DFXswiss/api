import { ExchangeTx } from '../../entities/exchange-tx.entity';

const defaultExchangeTx: Partial<ExchangeTx> = {
  id: 1,
};

export function createDefaultExchangeTx(): ExchangeTx {
  return createCustomExchangeTx({});
}

export function createCustomExchangeTx(customValues: Partial<ExchangeTx>): ExchangeTx {
  return Object.assign(new ExchangeTx(), { ...defaultExchangeTx, ...customValues });
}
