import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService, Configuration } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CoinGeckoService } from '../coin-gecko.service';

describe('CoinGeckoService', () => {
  let service: CoinGeckoService;
  let simplePrice: jest.Mock;

  const connectFailure = () => Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    service = new CoinGeckoService();
    simplePrice = jest.fn();
    (service as any).client = { simplePrice };
    (service as any).currencies = ['usd', 'chf'];
  });

  afterEach(() => jest.restoreAllMocks());

  it('retries once on a transient connect failure and returns the price', async () => {
    simplePrice.mockRejectedValueOnce(connectFailure()).mockResolvedValueOnce({ sometoken: { chf: 4 } });

    const price = await service.getPrice('sometoken', 'chf', '');

    expect(price.price).toBe(0.25);
    expect(simplePrice).toHaveBeenCalledTimes(2);
  });

  it('fails after the bounded retry when the outage persists', async () => {
    simplePrice.mockRejectedValue(connectFailure());

    await expect(service.getPrice('sometoken', 'chf', '')).rejects.toThrow(ServiceUnavailableException);
    expect(simplePrice).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-network errors', async () => {
    simplePrice.mockRejectedValue(new Error('Rate limit exceeded'));

    await expect(service.getPrice('sometoken', 'chf', '')).rejects.toThrow(ServiceUnavailableException);
    expect(simplePrice).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the response carries no price', async () => {
    simplePrice.mockResolvedValue({});

    await expect(service.getPrice('sometoken', 'chf', '')).rejects.toThrow(ServiceUnavailableException);
    expect(simplePrice).toHaveBeenCalledTimes(1);
  });
});
