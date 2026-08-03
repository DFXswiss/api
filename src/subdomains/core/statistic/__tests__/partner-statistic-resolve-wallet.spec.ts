import { ForbiddenException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

/**
 * Unit tests for role-aware wallet resolution — the tenant boundary between
 * company tokens (jwt.user = wallet id) and NON_CUSTODIAL_WALLET_PARTNER tokens (jwt.user = user id).
 */
describe('PartnerStatisticService.resolveWalletId', () => {
  const findOne = jest.fn();
  const userRepo = { findOne } as any;
  const service = new PartnerStatisticService({} as any, {} as any, userRepo, {} as any);

  beforeEach(() => {
    findOne.mockReset();
  });

  it('CLIENT_COMPANY: returns jwt.user as wallet id without loading a user', async () => {
    // Real company token: no account field (generateCompanyToken).
    const jwt = { user: 42, role: UserRole.CLIENT_COMPANY } as JwtPayload;
    await expect(service.resolveWalletId(jwt)).resolves.toBe(42);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('KYC_CLIENT_COMPANY: same as CLIENT_COMPANY (hierarchy super-role)', async () => {
    const jwt = { user: 15, role: UserRole.KYC_CLIENT_COMPANY } as JwtPayload;
    await expect(service.resolveWalletId(jwt)).resolves.toBe(15);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('CLIENT_COMPANY with account (user token): rejects — does not treat user id as wallet id', async () => {
    // Malicious / contradictory: normal login token (account set) whose role was stored as
    // CLIENT_COMPANY on the user row. jwt.user is a user id that equals a foreign wallet id.
    const jwt = { user: 99, account: 5, role: UserRole.CLIENT_COMPANY } as JwtPayload;

    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolveWalletId(jwt)).rejects.toThrow(/company token/i);
    // Must not fall through to NON_CUSTODIAL_WALLET_PARTNER lookup, and must not return 99 as wallet id.
    expect(findOne).not.toHaveBeenCalled();
  });

  it('KYC_CLIENT_COMPANY with account (user token): same reject', async () => {
    const jwt = { user: 99, account: 5, role: UserRole.KYC_CLIENT_COMPANY } as JwtPayload;

    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('NON_CUSTODIAL_WALLET_PARTNER: loads user and returns their wallet id — not jwt.user', async () => {
    // Critical tenant case: user id 99 equals foreign wallet 99; own wallet is 7.
    const jwt = { user: 99, role: UserRole.NON_CUSTODIAL_WALLET_PARTNER } as JwtPayload;
    findOne.mockResolvedValue({ id: 99, wallet: { id: 7 } });

    await expect(service.resolveWalletId(jwt)).resolves.toBe(7);

    expect(findOne).toHaveBeenCalledWith({ where: { id: 99 }, relations: { wallet: true } });
    await expect(service.resolveWalletId(jwt)).resolves.not.toBe(99);
  });

  it('NON_CUSTODIAL_WALLET_PARTNER: rejects when user has no wallet (Forbidden, not silent 0)', async () => {
    const jwt = { user: 5, role: UserRole.NON_CUSTODIAL_WALLET_PARTNER } as JwtPayload;
    findOne.mockResolvedValue({ id: 5, wallet: null });

    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolveWalletId(jwt)).rejects.toThrow(/no wallet/i);
  });

  it('NON_CUSTODIAL_WALLET_PARTNER: rejects when user is missing', async () => {
    const jwt = { user: 5, role: UserRole.NON_CUSTODIAL_WALLET_PARTNER } as JwtPayload;
    findOne.mockResolvedValue(null);

    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('USER (no permission): rejects', async () => {
    const jwt = { user: 1, role: UserRole.USER } as JwtPayload;
    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('CLIENT_COMPANY without jwt.user: rejects', async () => {
    const jwt = { role: UserRole.CLIENT_COMPANY } as JwtPayload;
    await expect(service.resolveWalletId(jwt)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
