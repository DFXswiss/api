import { WalletRepository } from '../wallet.repository';
import { WalletService } from '../wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let repo: jest.Mocked<Partial<WalletRepository>>;

  beforeEach(() => {
    repo = { findOneCachedBy: jest.fn() };

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

    it('still queries when an address is supplied', async () => {
      repo.findOneCachedBy.mockResolvedValue(undefined);

      await service.getByAddress('0xabc');

      expect(repo.findOneCachedBy).toHaveBeenCalledWith('0xabc', { address: '0xabc' });
    });
  });
});
