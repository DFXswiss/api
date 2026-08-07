import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { TestUtil } from 'src/shared/utils/test.util';
import { SpecialExternalAccountType } from '../../entities/special-external-account.entity';
import { createCustomSpecialExternalAccount } from '../../__mocks__/special-external-account.entity.mock';
import { SpecialExternalAccountRepository } from '../../repositories/special-external-account.repository';
import { SpecialExternalAccountService } from '../special-external-account.service';

describe('SpecialExternalAccountService', () => {
  let service: SpecialExternalAccountService;
  let repo: MockProxy<SpecialExternalAccountRepository>;

  beforeAll(async () => {
    repo = mock<SpecialExternalAccountRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: SpecialExternalAccountRepository, useValue: repo },
        SpecialExternalAccountService,
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SpecialExternalAccountService>(SpecialExternalAccountService);
  });

  describe('isScorechainExemptAddress', () => {
    const exemption = createCustomSpecialExternalAccount({
      type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
      value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
      updated: new Date(),
    });

    it('matches an exempted address exactly', async () => {
      repo.findCachedBy.mockResolvedValue([exemption]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(true);
    });

    it('matches case-insensitively (checksum vs. lowercase address)', async () => {
      repo.findCachedBy.mockResolvedValue([exemption]);

      await expect(service.isScorechainExemptAddress('0xfa73137a652633302dedc91a79ebdadb81e0d2c5')).resolves.toBe(true);
    });

    it('does not match a different address', async () => {
      repo.findCachedBy.mockResolvedValue([exemption]);

      await expect(service.isScorechainExemptAddress('0x0000000000000000000000000000000000000001')).resolves.toBe(
        false,
      );
    });

    it('does not treat an exemption value as a regex/prefix pattern', async () => {
      repo.findCachedBy.mockResolvedValue([
        createCustomSpecialExternalAccount({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: '0xFA73',
        }),
      ]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });

    it('returns false when no exemptions exist', async () => {
      repo.findCachedBy.mockResolvedValue([]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });

    it('ignores entries without a value', async () => {
      repo.findCachedBy.mockResolvedValue([
        createCustomSpecialExternalAccount({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: undefined,
          updated: new Date(),
        }),
      ]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });

    // An exemption ages like the account-level review: after the validity window the address is
    // screened again, no matter how the entry was registered.
    it('does not honor an expired exemption', async () => {
      repo.findCachedBy.mockResolvedValue([
        createCustomSpecialExternalAccount({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
          updated: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000),
        }),
      ]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });

    // Bounded on both sides like UserData.hasValidScorechainReview: an implausible future date must
    // never suppress the screening for longer than the configured window.
    it('does not honor an exemption with a future date', async () => {
      repo.findCachedBy.mockResolvedValue([
        createCustomSpecialExternalAccount({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
          updated: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        }),
      ]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });
  });

  describe('registerScorechainExemptAddress', () => {
    beforeEach(() => {
      repo.findBy.mockReset();
      repo.update.mockReset();
      repo.save.mockReset();
      repo.create.mockImplementation((dto) => dto as any);
    });

    it('creates a new entry for an unknown address', async () => {
      repo.findBy.mockResolvedValue([]);

      await service.registerScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5', 'released tx 7');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
          comment: 'released tx 7',
        }),
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.invalidateCache).toHaveBeenCalled();
    });

    // A re-release refreshes the existing row (restarting the validity window via `updated`) instead
    // of stacking duplicates — matched case-insensitively like the lookup.
    it('updates the existing entry for a known address, matched case-insensitively', async () => {
      const existing = createCustomSpecialExternalAccount({
        id: 12,
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
      });
      repo.findBy.mockResolvedValue([existing]);

      await service.registerScorechainExemptAddress('0xfa73137a652633302dedc91a79ebdadb81e0d2c5', 'released tx 8');

      expect(repo.update).toHaveBeenCalledWith(12, { comment: 'released tx 8' });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
