import { createMock } from '@golevelup/ts-jest';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { LetterService } from 'src/integration/letter/letter.service';
import { Util } from 'src/shared/utils/util';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { ExternalServicesObserver } from '../external-services.observer';

describe('ExternalServicesObserver', () => {
  let observer: ExternalServicesObserver;
  let ibanService: { isConfigured: boolean; getBalance: jest.Mock };
  let letterService: { isConfigured: boolean; getBalance: jest.Mock };

  beforeEach(() => {
    ibanService = { isConfigured: true, getBalance: jest.fn().mockResolvedValue(100) };
    letterService = { isConfigured: true, getBalance: jest.fn().mockResolvedValue(50) };

    observer = new ExternalServicesObserver(
      createMock<MonitoringService>(),
      ibanService as unknown as IbanService,
      letterService as unknown as LetterService,
    );

    jest.spyOn(Util, 'delay').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports all configured services online when balance checks succeed', async () => {
    await expect(observer.fetch()).resolves.toEqual([
      { name: 'IBAN', balance: 100, status: 'Online' },
      { name: 'Letter', balance: 50, status: 'Online' },
    ]);
  });

  it('skips unconfigured services instead of reporting them offline', async () => {
    letterService.isConfigured = false;

    await expect(observer.fetch()).resolves.toEqual([{ name: 'IBAN', balance: 100, status: 'Online' }]);
    expect(letterService.getBalance).not.toHaveBeenCalled();
  });

  it('returns an empty list when no service is configured', async () => {
    ibanService.isConfigured = false;
    letterService.isConfigured = false;

    await expect(observer.fetch()).resolves.toEqual([]);
  });

  it('reports a service offline when its balance check keeps failing', async () => {
    ibanService.getBalance.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await expect(observer.fetch()).resolves.toEqual([
      { name: 'IBAN', status: 'Offline' },
      { name: 'Letter', balance: 50, status: 'Online' },
    ]);
    expect(ibanService.getBalance).toHaveBeenCalledTimes(3);
  });

  it('absorbs a transient failure via retry and still reports online', async () => {
    ibanService.getBalance
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      .mockResolvedValueOnce(100);

    await expect(observer.fetch()).resolves.toEqual([
      { name: 'IBAN', balance: 100, status: 'Online' },
      { name: 'Letter', balance: 50, status: 'Online' },
    ]);
    expect(ibanService.getBalance).toHaveBeenCalledTimes(3);
  });

  it('reports a zero balance as offline', async () => {
    letterService.getBalance.mockResolvedValue(0);

    await expect(observer.fetch()).resolves.toEqual([
      { name: 'IBAN', balance: 100, status: 'Online' },
      { name: 'Letter', balance: 0, status: 'Offline' },
    ]);
  });
});
