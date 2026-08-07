import { createMock } from '@golevelup/ts-jest';
import { Currencies, Exchange, Transaction } from 'ccxt';
import { XtService } from '../xt.service';

jest.mock('src/config/config', () => {
  const mockConfig = { xt: { apiKey: 'key', secret: 'secret' } };
  return { Config: mockConfig, GetConfig: () => mockConfig };
});

const NETWORK = 'BNB Smart Chain';

// neutral round numbers, in the string form ccxt publishes per network
const venueNetworks = {
  'BNB Smart Chain': {
    id: 'BNB Smart Chain',
    limits: { withdraw: { min: '0.500000000000000000', max: '50.000000000000000000' } },
  },
};

describe('XtService', () => {
  let service: XtService;
  let exchange: Exchange;

  beforeEach(() => {
    service = new XtService();

    exchange = createMock<Exchange>();
    Object.assign(service, { exchange });

    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    service['queue'].stop();
    jest.restoreAllMocks();
  });

  // XT addresses the network as `chain` and takes no withdrawal key, which is the whole of its difference from
  // the base venue call
  it('should send the network as chain', async () => {
    jest.spyOn(exchange, 'withdraw').mockResolvedValue({ id: 'w-1' } as unknown as Transaction);

    await service.withdrawFunds('USDT', 1, 'address', 'unused-key', NETWORK);

    expect(exchange.withdraw).toHaveBeenCalledWith('USDT', 1, 'address', undefined, { chain: NETWORK });
  });

  // the cap runs on XT as on every other ccxt venue, so a rejection for exceeding the maximum has to drop the
  // limits it was capped against - kept, they would cap every retry of the next hour to the rejected amount
  it('should reload the limits after a withdrawal was rejected for exceeding the maximum', async () => {
    jest
      .spyOn(exchange, 'fetchCurrencies')
      .mockResolvedValue({ USDT: { networks: venueNetworks } } as unknown as Currencies);
    // one of the phrasings the base class recognizes as an over-maximum rejection
    jest.spyOn(exchange, 'withdraw').mockRejectedValue(new Error('withdrawal exceeds the maximum'));

    await expect(service.getWithdrawalLimits('USDT', NETWORK)).resolves.toEqual({ min: 0.5, max: 50 });
    await expect(service.withdrawFunds('USDT', 50, 'address', 'unused-key', NETWORK)).rejects.toThrow(
      'exceeds the maximum',
    );
    await expect(service.getWithdrawalLimits('USDT', NETWORK)).resolves.toEqual({ min: 0.5, max: 50 });

    expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(2);
  });

  it('should keep the cached limits when a withdrawal fails for another reason', async () => {
    jest
      .spyOn(exchange, 'fetchCurrencies')
      .mockResolvedValue({ USDT: { networks: venueNetworks } } as unknown as Currencies);
    jest.spyOn(exchange, 'withdraw').mockRejectedValue(new Error('Insufficient funds'));

    await service.getWithdrawalLimits('USDT', NETWORK);
    await expect(service.withdrawFunds('USDT', 50, 'address', 'unused-key', NETWORK)).rejects.toThrow(
      'Insufficient funds',
    );
    await service.getWithdrawalLimits('USDT', NETWORK);

    expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(1);
  });
});
