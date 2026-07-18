import { ServiceUnavailableException } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { IbanBankName } from '../../../bank/dto/bank.dto';
import { YapealVibanProvider } from '../yapeal-viban.provider';

describe('YapealVibanProvider', () => {
  let yapealService: { isAvailable: jest.Mock; createViban: jest.Mock };
  let provider: YapealVibanProvider;

  beforeEach(() => {
    yapealService = {
      isAvailable: jest.fn(),
      createViban: jest.fn(),
    };
    provider = new YapealVibanProvider(yapealService as unknown as YapealService);
  });

  it('exposes Yapeal bank name and CHF currency', () => {
    expect(provider.bankName).toBe(IbanBankName.YAPEAL);
    expect(provider.currencies).toEqual(['CHF']);
  });

  it('delegates isAvailable to yapealService', () => {
    yapealService.isAvailable.mockReturnValue(true);
    expect(provider.isAvailable()).toBe(true);

    yapealService.isAvailable.mockReturnValue(false);
    expect(provider.isAvailable()).toBe(false);
  });

  it('throws ServiceUnavailableException and never calls createViban when not available', async () => {
    yapealService.isAvailable.mockReturnValue(false);

    await expect(provider.reserveViban('CH9300762011623852957')).rejects.toThrow(
      new ServiceUnavailableException('Yapeal service is not available'),
    );
    expect(yapealService.createViban).not.toHaveBeenCalled();
  });

  it('maps createViban response to ReservedViban (providerAccountRef from accountUid)', async () => {
    yapealService.isAvailable.mockReturnValue(true);
    yapealService.createViban.mockResolvedValue({
      accountUid: 'acc-uid-1',
      bban: '761623852957',
      expiresAt: '2026-12-31T00:00:00Z',
      iban: 'CH9300762011623852957',
    });

    await expect(provider.reserveViban('CH9300762011623852957')).resolves.toEqual({
      iban: 'CH9300762011623852957',
      bban: '761623852957',
      providerAccountRef: 'acc-uid-1',
    });
    expect(yapealService.createViban).toHaveBeenCalledWith('CH9300762011623852957');
  });
});
