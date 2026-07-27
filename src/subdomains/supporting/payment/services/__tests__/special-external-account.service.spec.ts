import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
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
      providers: [{ provide: SpecialExternalAccountRepository, useValue: repo }, SpecialExternalAccountService],
    }).compile();

    service = module.get<SpecialExternalAccountService>(SpecialExternalAccountService);
  });

  describe('isScorechainExemptAddress', () => {
    const exemption = createCustomSpecialExternalAccount({
      type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
      value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
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
        }),
      ]);

      await expect(service.isScorechainExemptAddress('0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5')).resolves.toBe(
        false,
      );
    });
  });
});
