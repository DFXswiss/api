import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { createCustomSpecialExternalAccount } from '../../__mocks__/special-external-account.entity.mock';
import { CreateSpecialExternalAccountDto } from '../../dto/input/create-special-external-account.dto';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../../entities/special-external-account.entity';
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

  beforeEach(() => {
    jest.clearAllMocks();
    repo.create.mockImplementation((dto) => Object.assign(new SpecialExternalAccount(), dto));
  });

  describe('isScorechainExemptAddress', () => {
    const address = '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5';

    it('returns true for a valid exemption on the same chain', async () => {
      const exemption = createCustomSpecialExternalAccount({
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        blockchain: Blockchain.ETHEREUM,
        value: address,
        created: new Date(),
      });
      // repo.find is SQL-filtered; the test supplies the already-filtered list for this call.
      repo.find.mockResolvedValue([exemption]);

      await expect(service.isScorechainExemptAddress(Blockchain.ETHEREUM, address)).resolves.toBe(true);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
            blockchain: Blockchain.ETHEREUM,
          }),
        }),
      );
      expect(repo.findCachedBy).not.toHaveBeenCalled();
    });

    it('returns false when no row exists for the requested chain (other-chain rows filtered out by SQL)', async () => {
      // Simulates SQL where-filtering: a different-chain row would not be returned by find.
      repo.find.mockResolvedValue([]);

      await expect(service.isScorechainExemptAddress(Blockchain.BITCOIN, address)).resolves.toBe(false);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
            blockchain: Blockchain.BITCOIN,
          }),
        }),
      );
    });

    it('returns false for an expired exemption row', async () => {
      const expired = createCustomSpecialExternalAccount({
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        blockchain: Blockchain.ETHEREUM,
        value: address,
        created: Util.daysBefore(Config.amlScorechainReviewValidity + 1),
      });
      repo.find.mockResolvedValue([expired]);

      await expect(service.isScorechainExemptAddress(Blockchain.ETHEREUM, address)).resolves.toBe(false);
    });
  });

  describe('registerScorechainExemptAddress', () => {
    it('saves an append-only event row with type, blockchain, value and comment', async () => {
      await service.registerScorechainExemptAddress(
        Blockchain.ETHEREUM,
        '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
        'released tx 7',
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          blockchain: Blockchain.ETHEREUM,
          value: '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5',
          comment: 'released tx 7',
        }),
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.findBy).not.toHaveBeenCalled();
      expect(repo.find).not.toHaveBeenCalled();
    });

    // Append-only: every release is a new immutable event row; concurrent re-releases must not
    // race a check-then-act upsert.
    it('saves a second row on re-registration without update or prior lookup', async () => {
      await service.registerScorechainExemptAddress(Blockchain.ETHEREUM, '0xabc', 'released tx 7');
      await service.registerScorechainExemptAddress(Blockchain.ETHEREUM, '0xabc', 'released tx 8');

      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.findBy).not.toHaveBeenCalled();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('createSpecialExternalAccount', () => {
    it('allows duplicate SCORECHAIN_EXEMPT_ADDRESS rows and invalidates the list cache', async () => {
      const dto = {
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        value: '0xabc',
        blockchain: Blockchain.ETHEREUM,
        comment: 'manual release',
      } as CreateSpecialExternalAccountDto;
      const saved = Object.assign(new SpecialExternalAccount(), dto, { id: 9 });
      repo.save.mockResolvedValue(saved);

      await expect(service.createSpecialExternalAccount(dto)).resolves.toBe(saved);
      expect(repo.findOneBy).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect(repo.invalidateCache).toHaveBeenCalled();
    });

    it('still rejects a duplicate non-exemption type with BadRequestException', async () => {
      const dto = {
        type: SpecialExternalAccountType.BANNED_IBAN,
        value: 'DE123',
      } as CreateSpecialExternalAccountDto;
      repo.findOneBy.mockResolvedValue(
        createCustomSpecialExternalAccount({
          type: SpecialExternalAccountType.BANNED_IBAN,
          value: 'DE123',
        }),
      );

      await expect(service.createSpecialExternalAccount(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
