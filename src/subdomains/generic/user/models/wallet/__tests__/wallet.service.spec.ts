import { Wallet } from '../wallet.entity';
import { WalletRepository } from '../wallet.repository';
import { WalletService } from '../wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let repo: jest.Mocked<Partial<WalletRepository>>;

  beforeEach(() => {
    repo = { findOneCachedBy: jest.fn(), findOneCached: jest.fn() };

    service = new WalletService(repo as unknown as WalletRepository);
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

  describe('getByIdOrName', () => {
    // The cache is keyed per repository, so an unnamespaced key shares a namespace with getDefault's
    // 'default' and getKycClients' 'kycClients'. It also has to include the relations shape: without
    // it a caller needing no relations and one needing `users` share an entry, and whichever asks
    // first decides what the other gets — the second then dereferences a relation that is not there.
    it('keys separately for the same wallet requested with different relations', async () => {
      repo.findOneCached.mockResolvedValue(undefined);

      await service.getByIdOrName(7);
      await service.getByIdOrName(7, undefined, { users: true });

      const [bare, withRelations] = repo.findOneCached.mock.calls.map((c) => c[0]);
      expect(bare).not.toEqual(withRelations);
    });

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
});
