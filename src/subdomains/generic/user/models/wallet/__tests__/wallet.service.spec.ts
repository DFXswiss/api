import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { WalletDto } from '../dto/wallet.dto';
import { Wallet } from '../wallet.entity';
import { WalletRepository } from '../wallet.repository';
import { WalletService } from '../wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let repo: jest.Mocked<WalletRepository>;
  let logService: jest.Mocked<LogService>;

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    repo = createMock<WalletRepository>();
    logService = createMock<LogService>();
    logService.create.mockResolvedValue({} as any);
    repo.create.mockImplementation((dto) => Object.assign(new Wallet(), dto) as Wallet);
    repo.save.mockImplementation(async (entity) => entity as Wallet);
    service = new WalletService(repo, logService);
  });

  describe('getByAddress', () => {
    // GET /v1/auth/challenge has no guard and passes ?address straight through. TypeORM drops an
    // undefined where value, so an absent address would leave an unconditioned lookup returning an
    // arbitrary wallet — cached under the key "undefined" — and getCompanyChallenge's own `!wallet`
    // rejection would never fire.
    it.each([undefined, null, ''])('does not query when the address is %p', async (address) => {
      const wallet = await service.getByAddress(address as string);

      expect(wallet).toBeUndefined();
      expect(repo.findOneCachedBy).not.toHaveBeenCalled();
    });

    it('still queries when an address is supplied, and returns what it finds', async () => {
      const wallet = { id: 7 } as Wallet;
      repo.findOneCachedBy.mockResolvedValue(wallet);

      // Asserting the return value, not just the call: without it, a body that queries and then
      // discards the result is indistinguishable from the guard's own `return undefined`.
      await expect(service.getByAddress('0xabc')).resolves.toBe(wallet);

      expect(repo.findOneCachedBy).toHaveBeenCalledWith('address:0xabc', { address: '0xabc' });
    });
  });

  describe('getDefault', () => {
    // The reachable collision this PR fixes: getDefault and getByAddress share one AsyncCache, and
    // getByAddress used the raw address, so an unauthenticated GET /auth/challenge?address=default
    // hit getDefault's warm entry and was handed the default wallet for an address no wallet has.
    // Namespacing the address side is what closes it — getDefault's own key is left alone.
    it('cannot be reached by an address lookup for the literal address "default"', async () => {
      repo.findOneCachedBy.mockResolvedValue(undefined);

      await service.getDefault();
      await service.getByAddress('default');

      const [defaultKey, addressKey] = repo.findOneCachedBy.mock.calls.map((c) => c[0]);
      expect(defaultKey).not.toEqual(addressKey);
    });
  });

  describe('getByIdOrName', () => {
    // findOneCached and findOneCachedBy share one AsyncCache per repository, so getByAddress and
    // getDefault can collide; getKycClients uses findCachedBy, which is a separate listCache. The key
    // also has to include the relations shape: without it a caller needing no relations and one
    // needing `users` share an entry, and whichever asks first decides what the other gets — the
    // second then dereferences a relation that is not there.
    it('keys separately for the same wallet requested with different relations', async () => {
      repo.findOneCached.mockResolvedValue(undefined);

      await service.getByIdOrName(7);
      await service.getByIdOrName(7, undefined, { users: true });

      const [bare, withRelations] = repo.findOneCached.mock.calls.map((c) => c[0]);
      expect(bare).not.toEqual(withRelations);
    });

    // The other half of the contract: differing keys alone would also be satisfied by a key that
    // never repeats, which would silently disable caching for every caller.
    it('keys identically for identical arguments', async () => {
      repo.findOneCached.mockResolvedValue(undefined);

      await service.getByIdOrName(7, undefined, { users: true });
      await service.getByIdOrName(7, undefined, { users: true });

      const [first, second] = repo.findOneCached.mock.calls.map((c) => c[0]);
      expect(first).toEqual(second);
    });

    // A missing name must not collide with the literal string, since dto.wallet is free text.
    it('distinguishes a missing name from the string "undefined"', async () => {
      repo.findOneCached.mockResolvedValue(undefined);

      await service.getByIdOrName(7);
      await service.getByIdOrName(7, 'undefined');

      const [missing, literal] = repo.findOneCached.mock.calls.map((c) => c[0]);
      expect(missing).not.toEqual(literal);
    });

    // Not a regression test — `!id && !name` is De Morgan-equivalent to the previous ternary. Kept
    // to pin that no query is issued, which the guard's shape makes easy to lose.
    it('does not query when neither id nor name is supplied', async () => {
      const wallet = await service.getByIdOrName();

      expect(wallet).toBeUndefined();
      expect(repo.findOneCached).not.toHaveBeenCalled();
    });

    it('still queries when an id is supplied', async () => {
      repo.findOneCached.mockResolvedValue(undefined);

      await service.getByIdOrName(7);

      expect(repo.findOneCached).toHaveBeenCalledWith(
        expect.stringContaining('idOrName:'),
        expect.objectContaining({ where: [{ id: 7 }, { name: undefined }] }),
      );
    });
  });

  describe('createWallet', () => {
    it('saves the wallet and invalidates the cache', async () => {
      const dto = { name: 'Partner' } as WalletDto;

      const saved = await service.createWallet(dto);

      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(repo.save).toHaveBeenCalled();
      expect(repo.invalidateCache).toHaveBeenCalledTimes(1);
      expect(saved.name).toBe('Partner');
      expect(logService.create).not.toHaveBeenCalled();
    });
  });

  describe('updateWallet', () => {
    it('writes a before→after audit record, then saves and invalidates the cache', async () => {
      const existing = Object.assign(new Wallet(), { id: 7, name: 'Old', paymentsApiEnabled: true });
      repo.findOneBy.mockResolvedValue(existing);

      const saved = await service.updateWallet(7, { paymentsApiEnabled: false } as WalletDto);

      expect(logService.create).toHaveBeenCalledWith({
        system: 'Wallet',
        subsystem: 'Update',
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          id: 7,
          changes: {
            paymentsApiEnabled: { previous: true, next: false },
          },
        }),
        category: '7',
        valid: null,
      });
      expect(logService.create.mock.invocationCallOrder[0]).toBeLessThan(repo.save.mock.invocationCallOrder[0]);
      expect(repo.save).toHaveBeenCalled();
      expect(repo.invalidateCache).toHaveBeenCalledTimes(1);
      expect(saved.paymentsApiEnabled).toBe(false);
    });

    it('does not save when the audit write fails (fail-closed)', async () => {
      const existing = Object.assign(new Wallet(), { id: 7, paymentsApiEnabled: true });
      repo.findOneBy.mockResolvedValue(existing);
      logService.create.mockRejectedValue(new Error('log write failed'));

      await expect(service.updateWallet(7, { paymentsApiEnabled: false } as WalletDto)).rejects.toThrow(
        'log write failed',
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.invalidateCache).not.toHaveBeenCalled();
    });

    it('records apiKey changes without cleartext previous/next', async () => {
      const existing = Object.assign(new Wallet(), { id: 7, apiKey: 'secret-old' });
      repo.findOneBy.mockResolvedValue(existing);

      await service.updateWallet(7, { apiKey: 'secret-new' } as WalletDto);

      const message = JSON.parse(logService.create.mock.calls[0][0].message as string);
      expect(message.changes.apiKey).toEqual({ changed: true });
      expect(JSON.stringify(message)).not.toContain('secret-old');
      expect(JSON.stringify(message)).not.toContain('secret-new');
    });

    it('writes no audit record when nothing actually changes', async () => {
      const existing = Object.assign(new Wallet(), { id: 7, name: 'Same', paymentsApiEnabled: true });
      repo.findOneBy.mockResolvedValue(existing);

      await service.updateWallet(7, { name: 'Same', paymentsApiEnabled: true } as WalletDto);

      expect(logService.create).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException and does not invalidate cache when missing', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.updateWallet(99, {} as WalletDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.invalidateCache).not.toHaveBeenCalled();
      expect(logService.create).not.toHaveBeenCalled();
    });
  });
});
