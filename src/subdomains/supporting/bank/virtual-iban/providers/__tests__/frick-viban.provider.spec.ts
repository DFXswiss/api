import { ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanBankName } from '../../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../frick-viban.provider';

function virtualIban(
  overrides: {
    vban?: string;
    state?: FrickVirtualIbanState;
    referenceAccountIban?: string;
  } = {},
) {
  return {
    vban: overrides.vban ?? 'LI75088110105923K000E',
    referenceAccountIban: overrides.referenceAccountIban ?? 'LI32088110105923K000C',
    state: overrides.state ?? FrickVirtualIbanState.PREPARED,
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'synthetic',
    activationApprovals: [],
    deactivationApprovals: [],
  };
}

describe('FrickVibanProvider', () => {
  let bankFrickService: {
    isVibanAvailable: jest.Mock;
    createViban: jest.Mock;
    approveVibanActivation: jest.Mock;
  };
  let provider: FrickVibanProvider;

  beforeEach(() => {
    bankFrickService = {
      isVibanAvailable: jest.fn(),
      createViban: jest.fn(),
      approveVibanActivation: jest.fn(),
    };
    provider = new FrickVibanProvider(bankFrickService as unknown as BankFrickService);
  });

  it('exposes Frick bank name and EUR currency', () => {
    expect(provider.bankName).toBe(IbanBankName.FRICK);
    expect(provider.currencies).toEqual(['EUR']);
  });

  it('delegates isAvailable to bankFrickService.isVibanAvailable', () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    expect(provider.isAvailable()).toBe(true);

    bankFrickService.isVibanAvailable.mockReturnValue(false);
    expect(provider.isAvailable()).toBe(false);
  });

  it('throws ServiceUnavailableException and never calls createViban when not available', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(false);

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN service is not available'),
    );
    expect(bankFrickService.createViban).not.toHaveBeenCalled();
  });

  it('returns an already ACTIVE create result without calling approveVibanActivation', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ vban: 'LI11ACTIVE00000000001', state: FrickVirtualIbanState.ACTIVE });
    bankFrickService.createViban.mockResolvedValue(created);

    await expect(provider.reserveViban('LI32088110105923K000C')).resolves.toEqual({
      iban: 'LI11ACTIVE00000000001',
      providerAccountRef: 'LI11ACTIVE00000000001',
    });
    expect(bankFrickService.approveVibanActivation).not.toHaveBeenCalled();
  });

  it('approves a PREPARED create and returns the activated vban', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ vban: 'LI22PREPARED00000001', state: FrickVirtualIbanState.PREPARED });
    const activated = virtualIban({ vban: 'LI22PREPARED00000001', state: FrickVirtualIbanState.ACTIVE });
    bankFrickService.createViban.mockResolvedValue(created);
    bankFrickService.approveVibanActivation.mockResolvedValue(activated);

    await expect(provider.reserveViban('LI32088110105923K000C')).resolves.toEqual({
      iban: 'LI22PREPARED00000001',
      providerAccountRef: 'LI22PREPARED00000001',
    });
    expect(bankFrickService.approveVibanActivation).toHaveBeenCalledWith('LI22PREPARED00000001');
  });

  it('throws when activation does not reach ACTIVE (fail-closed)', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ vban: 'LI33STUCK00000000001', state: FrickVirtualIbanState.PREPARED });
    const stillPrepared = virtualIban({
      vban: 'LI33STUCK00000000001',
      state: FrickVirtualIbanState.PREPARED,
    });
    bankFrickService.createViban.mockResolvedValue(created);
    bankFrickService.approveVibanActivation.mockResolvedValue(stillPrepared);

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      /Bank Frick virtual IBAN LI33STUCK00000000001 could not be activated \(state: PREPARED\)/,
    );
  });
});
