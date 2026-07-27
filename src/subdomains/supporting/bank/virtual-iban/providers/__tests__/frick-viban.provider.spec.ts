import { ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { BankFrickService, FrickVibanNotCreatedError } from 'src/integration/bank/services/frick.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IbanBankName } from '../../../bank/dto/bank.dto';
import { FrickVibanProvider } from '../frick-viban.provider';
import { VibanAccountHolder } from '../viban-account-holder.enum';
import { VibanNotCreatedError } from '../viban-provider.interface';

function virtualIban(
  overrides: {
    vban?: string;
    state?: FrickVirtualIbanState;
    referenceAccountIban?: string;
    description?: string;
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
    ...(overrides.description && { description: overrides.description }),
  };
}

describe('FrickVibanProvider', () => {
  let bankFrickService: {
    isVibanAvailable: jest.Mock;
    prepareVibanCreate: jest.Mock;
    createViban: jest.Mock;
    approveVibanActivation: jest.Mock;
    listAllVibans: jest.Mock;
  };
  let provider: FrickVibanProvider;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    bankFrickService = {
      isVibanAvailable: jest.fn(),
      prepareVibanCreate: jest.fn(),
      createViban: jest.fn(),
      approveVibanActivation: jest.fn(),
      listAllVibans: jest.fn(),
    };
    provider = new FrickVibanProvider(bankFrickService as unknown as BankFrickService);
    loggerError = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  it('exposes Frick bank name and EUR currency', () => {
    expect(provider.bankName).toBe(IbanBankName.FRICK);
    expect(provider.currencies).toEqual(['EUR']);
    expect(provider.accountHolder).toBe(VibanAccountHolder.DFX);
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

  it('preflights the exact base account and technical description without creating a vIBAN', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.prepareVibanCreate.mockResolvedValue(undefined);

    await provider.prepareVibanReservation('LI32088110105923K000C', 'dfx-viban-technical-reference');

    expect(bankFrickService.prepareVibanCreate).toHaveBeenCalledWith(
      'LI32088110105923K000C',
      'dfx-viban-technical-reference',
    );
    expect(bankFrickService.createViban).not.toHaveBeenCalled();
  });

  it('maps a preflight integration error to a classified service unavailable without embedding the cause', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const cause = new Error('authorization failed');
    bankFrickService.prepareVibanCreate.mockRejectedValue(cause);

    await expect(provider.prepareVibanReservation('LI32088110105923K000C', 'reference')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN preflight failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN preflight failed', cause);
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

  it('passes the non-PII issuance reference as the exact Frick description', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ state: FrickVirtualIbanState.ACTIVE });
    bankFrickService.createViban.mockResolvedValue(created);

    await provider.reserveViban('LI32088110105923K000C', 'dfx-viban-technical-reference');

    expect(bankFrickService.createViban).toHaveBeenCalledWith('LI32088110105923K000C', 'dfx-viban-technical-reference');
  });

  it('maps a definitely rejected Frick create to the provider-level retry signal with a classified message', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.createViban.mockRejectedValue(
      new FrickVibanNotCreatedError(
        'Bank Frick API request failed (POST virtual-ibans?account=LI32088110105923K000C): HTTP 422',
      ),
    );

    let caught: unknown;
    try {
      await provider.reserveViban('LI32088110105923K000C');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VibanNotCreatedError);
    expect((caught as Error).message).toBe('Bank Frick virtual IBAN create rejected');
    expect((caught as Error).message).not.toContain('LI32088110105923K000C');
    expect((caught as Error).message).not.toContain('HTTP 422');
  });

  it('maps an ambiguous create integration error to a classified service unavailable without embedding the cause', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const cause = new Error('socket closed');
    bankFrickService.createViban.mockRejectedValue(cause);

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN creation failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN creation failed', cause);
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

  it('throws when activation does not reach ACTIVE (fail-closed) without embedding the vban', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ vban: 'LI33STUCK00000000001', state: FrickVirtualIbanState.PREPARED });
    const stillPrepared = virtualIban({
      vban: 'LI33STUCK00000000001',
      state: FrickVirtualIbanState.PREPARED,
    });
    bankFrickService.createViban.mockResolvedValue(created);
    bankFrickService.approveVibanActivation.mockResolvedValue(stillPrepared);

    let message = '';
    try {
      await provider.reserveViban('LI32088110105923K000C');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Bank Frick virtual IBAN could not be activated \(state: PREPARED, vbanLength=\d+\)/);
    expect(message).not.toContain('LI33STUCK00000000001');
  });

  it('fails closed when activation returns a different vban without embedding either IBAN', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const created = virtualIban({ vban: 'LI22PREPARED00000001', state: FrickVirtualIbanState.PREPARED });
    const mismatched = virtualIban({ vban: 'LI99OTHER00000000001', state: FrickVirtualIbanState.ACTIVE });
    bankFrickService.createViban.mockResolvedValue(created);
    bankFrickService.approveVibanActivation.mockResolvedValue(mismatched);

    let message = '';
    try {
      await provider.reserveViban('LI32088110105923K000C');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(
      /Bank Frick virtual IBAN activation identity mismatch \(createdLength=\d+, activatedLength=\d+\)/,
    );
    expect(message).not.toContain('LI22PREPARED00000001');
    expect(message).not.toContain('LI99OTHER00000000001');
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringMatching(/activation identity mismatch \(createdLength=\d+, activatedLength=\d+\)/),
    );
  });

  it('maps an activation integration error to a classified service unavailable without embedding the cause', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.createViban.mockResolvedValue(virtualIban({ state: FrickVirtualIbanState.PREPARED }));
    const cause = new Error('upstream unavailable');
    bankFrickService.approveVibanActivation.mockRejectedValue(cause);

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN activation failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN activation failed', cause);
  });

  it('requests every lifecycle state for the strongest available reference-account evidence', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const listed = [virtualIban({ description: 'dfx-viban-a' }), virtualIban({ description: 'dfx-viban-b' })];
    const result = {
      virtualIbans: listed,
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    };
    bankFrickService.listAllVibans.mockResolvedValue(result);

    await expect(provider.listByReferenceAccount('LI32088110105923K000C')).resolves.toBe(result);
    expect(bankFrickService.listAllVibans).toHaveBeenCalledWith('LI32088110105923K000C', undefined, 50);
  });

  it('maps a listing integration error to a classified service unavailable without embedding the cause', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const cause = new Error('upstream unavailable');
    bankFrickService.listAllVibans.mockRejectedValue(cause);

    await expect(provider.listByReferenceAccount('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN listing failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN listing failed', cause);
  });

  it('finds exactly one recoverable vIBAN by exact description across the full listing', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const exact = virtualIban({ description: 'dfx-viban-reference' });
    bankFrickService.listAllVibans.mockResolvedValue({
      virtualIbans: [virtualIban({ description: 'dfx-viban-reference-other' }), exact],
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    });

    await expect(provider.findRecoverableByDescription('dfx-viban-reference', 'LI32088110105923K000C')).resolves.toBe(
      exact,
    );
    expect(bankFrickService.listAllVibans).toHaveBeenCalledWith(
      'LI32088110105923K000C',
      [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE],
      50,
    );
  });

  it('fails closed when the same recovery description has multiple matches', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.listAllVibans.mockResolvedValue({
      virtualIbans: [
        virtualIban({ description: 'dfx-viban-duplicate' }),
        virtualIban({ vban: 'LI11ACTIVE00000000001', description: 'dfx-viban-duplicate' }),
      ],
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    });

    await expect(provider.findRecoverableByDescription('dfx-viban-duplicate', 'LI32088110105923K000C')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('maps a recovery listing integration error to a classified service unavailable without embedding the cause', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const cause = new Error('upstream unavailable');
    bankFrickService.listAllVibans.mockRejectedValue(cause);

    await expect(provider.findRecoverableByDescription('dfx-viban-reference', 'LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN recovery failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN recovery failed', cause);
  });

  it('maps a non-Error preflight cause to the same classified service unavailable without embedding it', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.prepareVibanCreate.mockRejectedValue('raw-string-failure');

    await expect(provider.prepareVibanReservation('LI32088110105923K000C', 'reference')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN preflight failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN preflight failed', undefined);
  });

  it('refuses listByReferenceAccount when the reference account is missing or blank', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);

    await expect(provider.listByReferenceAccount('')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN reference account is missing'),
    );
    await expect(provider.listByReferenceAccount('   ')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN reference account is missing'),
    );
    await expect(provider.listByReferenceAccount(null as unknown as string)).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN reference account is missing'),
    );
    expect(bankFrickService.listAllVibans).not.toHaveBeenCalled();
  });

  it('refuses findRecoverableByDescription when the recovery reference is missing or blank', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);

    await expect(provider.findRecoverableByDescription('', 'LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN recovery reference is missing'),
    );
    await expect(provider.findRecoverableByDescription('   ', 'LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN recovery reference is missing'),
    );
    await expect(
      provider.findRecoverableByDescription(null as unknown as string, 'LI32088110105923K000C'),
    ).rejects.toThrow(new ServiceUnavailableException('Bank Frick virtual IBAN recovery reference is missing'));
    expect(bankFrickService.listAllVibans).not.toHaveBeenCalled();
  });

  it('refuses adoptAndActivate when Frick vIBAN service is not available', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(false);
    const prepared = virtualIban({ state: FrickVirtualIbanState.PREPARED });

    await expect(provider.adoptAndActivate(prepared)).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN service is not available'),
    );
    expect(bankFrickService.approveVibanActivation).not.toHaveBeenCalled();
  });

  it('adoptAndActivate activates a PREPARED match and returns the reserved shape', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const prepared = virtualIban({ vban: 'LI44ADOPT00000000001', state: FrickVirtualIbanState.PREPARED });
    bankFrickService.approveVibanActivation.mockResolvedValue(
      virtualIban({ vban: 'LI44ADOPT00000000001', state: FrickVirtualIbanState.ACTIVE }),
    );

    await expect(provider.adoptAndActivate(prepared)).resolves.toEqual({
      iban: 'LI44ADOPT00000000001',
      providerAccountRef: 'LI44ADOPT00000000001',
    });
    expect(bankFrickService.approveVibanActivation).toHaveBeenCalledWith('LI44ADOPT00000000001');
  });

  it('throws ServiceUnavailableException from prepare when not available', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(false);

    await expect(provider.prepareVibanReservation('LI32088110105923K000C', 'ref')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN service is not available'),
    );
    expect(bankFrickService.prepareVibanCreate).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException from listByReferenceAccount when not available', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(false);

    await expect(provider.listByReferenceAccount('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN service is not available'),
    );
    expect(bankFrickService.listAllVibans).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException from findRecoverableByDescription when not available', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(false);

    await expect(provider.findRecoverableByDescription('dfx-viban-reference', 'LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN service is not available'),
    );
    expect(bankFrickService.listAllVibans).not.toHaveBeenCalled();
  });

  it('returns undefined when recovery listing has no matching description', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.listAllVibans.mockResolvedValue({
      virtualIbans: [virtualIban({ description: 'dfx-viban-other' })],
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    });

    await expect(
      provider.findRecoverableByDescription('dfx-viban-missing', 'LI32088110105923K000C'),
    ).resolves.toBeUndefined();
  });

  it('ignores recovery candidates whose referenceAccountIban does not match after normalization', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.listAllVibans.mockResolvedValue({
      virtualIbans: [
        virtualIban({
          description: 'dfx-viban-reference',
          referenceAccountIban: 'LI9999999999999999999',
        }),
      ],
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    });

    await expect(
      provider.findRecoverableByDescription('dfx-viban-reference', 'LI32088110105923K000C'),
    ).resolves.toBeUndefined();
  });

  it('matches recovery after normalizing spaces and case on the reference account IBAN', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    const exact = virtualIban({
      description: 'dfx-viban-reference',
      referenceAccountIban: 'LI32088110105923K000C',
    });
    bankFrickService.listAllVibans.mockResolvedValue({
      virtualIbans: [exact],
      fullyValidated: true,
      listingStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      listingCompletedAt: new Date('2026-07-01T00:00:01.000Z'),
    });

    await expect(
      provider.findRecoverableByDescription('dfx-viban-reference', 'li32 0881 1010 5923 k000c'),
    ).resolves.toBe(exact);
  });

  it('maps a non-Error create cause to classified service unavailable without embedding it', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.createViban.mockRejectedValue('raw-create-failure');

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN creation failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN creation failed', undefined);
  });

  it('maps a non-Error listing cause to classified service unavailable without embedding it', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.listAllVibans.mockRejectedValue('raw-list-failure');

    await expect(provider.listByReferenceAccount('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN listing failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN listing failed', undefined);
  });

  it('maps a non-Error recovery listing cause to classified service unavailable without embedding it', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.listAllVibans.mockRejectedValue('raw-recovery-failure');

    await expect(provider.findRecoverableByDescription('dfx-viban-reference', 'LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN recovery failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN recovery failed', undefined);
  });

  it('maps a non-Error activation cause to classified service unavailable without embedding it', async () => {
    bankFrickService.isVibanAvailable.mockReturnValue(true);
    bankFrickService.createViban.mockResolvedValue(virtualIban({ state: FrickVirtualIbanState.PREPARED }));
    bankFrickService.approveVibanActivation.mockRejectedValue('raw-activation-failure');

    await expect(provider.reserveViban('LI32088110105923K000C')).rejects.toThrow(
      new ServiceUnavailableException('Bank Frick virtual IBAN activation failed'),
    );
    expect(loggerError).toHaveBeenCalledWith('Bank Frick virtual IBAN activation failed', undefined);
  });
});
