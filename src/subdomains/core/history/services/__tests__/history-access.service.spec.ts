import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { SetStaffKycClearance } from 'src/shared/auth/staff-kyc-clearance';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { HistoryAccessService } from '../history-access.service';

describe('HistoryAccessService', () => {
  let service: HistoryAccessService;
  let userService: jest.Mocked<UserService>;
  let userDataService: jest.Mocked<UserDataService>;

  const accountUsers = [{ id: 10, address: '0xAAA' } as User, { id: 11, address: '0xBBB' } as User];
  const account = { id: 1, users: accountUsers } as UserData;

  beforeEach(() => {
    userService = createMock<UserService>();
    userDataService = createMock<UserDataService>();
    service = new HistoryAccessService(userService, userDataService);
  });

  describe('resolveListSubject', () => {
    it('rejects when neither JWT nor API key is provided', async () => {
      await expect(service.resolveListSubject({})).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects JWT without account', async () => {
      await expect(
        service.resolveListSubject({ jwt: { role: UserRole.USER, ip: '1.1.1.1' } as JwtPayload }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns account history for account JWT without address filter', async () => {
      userDataService.getUserData.mockResolvedValue(account);

      const subject = await service.resolveListSubject({
        jwt: { role: UserRole.ACCOUNT, ip: '1.1.1.1', account: 1 },
      });

      expect(subject).toBe(account);
      expect(userDataService.getUserData).toHaveBeenCalledWith(1, { users: true });
    });

    it('scopes JWT to jwt.address when no userAddress query', async () => {
      userDataService.getUserData.mockResolvedValue(account);

      const subject = await service.resolveListSubject({
        jwt: { role: UserRole.USER, ip: '1.1.1.1', account: 1, address: '0xaaa', user: 10 },
      });

      expect(subject).toMatchObject({ id: 10, address: '0xAAA' });
      expect((subject as User).userData).toBe(account);
    });

    it('allows userAddress that belongs to the account (case-insensitive)', async () => {
      userDataService.getUserData.mockResolvedValue(account);

      const subject = await service.resolveListSubject({
        jwt: { role: UserRole.USER, ip: '1.1.1.1', account: 1, address: '0xAAA', user: 10 },
        userAddress: '0xbbb',
      });

      expect(subject).toMatchObject({ id: 11, address: '0xBBB' });
    });

    it('forbids userAddress that does not belong to the account', async () => {
      userDataService.getUserData.mockResolvedValue(account);

      await expect(
        service.resolveListSubject({
          jwt: { role: UserRole.USER, ip: '1.1.1.1', account: 1, address: '0xAAA', user: 10 },
          userAddress: '0xEVIL',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when JWT account cannot be loaded', async () => {
      userDataService.getUserData.mockResolvedValue(null);

      await expect(
        service.resolveListSubject({
          jwt: { role: UserRole.ACCOUNT, ip: '1.1.1.1', account: 99 },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('resolves user API key (suffix 0) without address filter', async () => {
      const user = { id: 10, address: '0xAAA', apiKeyCT: 'KEY0' } as User;
      userService.checkApiKey.mockResolvedValue(user);

      const subject = await service.resolveListSubject({
        apiKey: 'KEY0',
        apiSign: 'sig',
        apiTimestamp: new Date().toISOString(),
      });

      expect(subject).toBe(user);
      expect(userService.checkApiKey).toHaveBeenCalled();
    });

    it('forbids address mismatch on user API key', async () => {
      const user = { id: 10, address: '0xAAA', apiKeyCT: 'KEY0' } as User;
      userService.checkApiKey.mockResolvedValue(user);

      await expect(
        service.resolveListSubject({
          apiKey: 'KEY0',
          apiSign: 'sig',
          apiTimestamp: 't',
          userAddress: '0xBBB',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves account API key and optional address filter', async () => {
      const ud = { id: 1, users: accountUsers, apiKeyCT: 'ACCT1' } as UserData;
      userDataService.checkApiKey.mockResolvedValue(ud);

      const subject = await service.resolveListSubject({
        apiKey: 'ACCT1',
        apiSign: 'sig',
        apiTimestamp: 't',
        userAddress: '0xBBB',
      });

      expect(subject).toMatchObject({ id: 11, address: '0xBBB' });
    });

    it('forbids address not on account API key', async () => {
      const ud = { id: 1, users: accountUsers, apiKeyCT: 'ACCT1' } as UserData;
      userDataService.checkApiKey.mockResolvedValue(ud);

      await expect(
        service.resolveListSubject({
          apiKey: 'ACCT1',
          apiSign: 'sig',
          apiTimestamp: 't',
          userAddress: '0xZZZ',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('prefers JWT over API key when both present', async () => {
      userDataService.getUserData.mockResolvedValue(account);

      await service.resolveListSubject({
        jwt: { role: UserRole.ACCOUNT, ip: '1.1.1.1', account: 1 },
        apiKey: 'KEY0',
        apiSign: 's',
        apiTimestamp: 't',
      });

      expect(userService.checkApiKey).not.toHaveBeenCalled();
      expect(userDataService.getUserData).toHaveBeenCalled();
    });
  });

  describe('canViewFullTransaction / isOwner', () => {
    const ownerJwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 1, user: 10, address: '0xAAA' };
    const otherJwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 2, user: 20, address: '0xCCC' };

    // Staff full access now additionally requires KYC clearance for the calling account; account 99 is
    // the cleared staff account used by the staff cases below.
    beforeEach(() => SetStaffKycClearance([99]));
    afterEach(() => SetStaffKycClearance([]));

    it('denies full view without JWT', () => {
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.canViewFullTransaction(undefined, tx)).toBe(false);
      expect(service.isOwner(undefined, tx)).toBe(false);
    });

    it('allows owner of Transaction via userData.id', () => {
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.isOwner(ownerJwt, tx)).toBe(true);
      expect(service.canViewFullTransaction(ownerJwt, tx)).toBe(true);
    });

    it('allows owner of TransactionRequest via user.userData.id', () => {
      const tx = { user: { userData: { id: 1 } } } as TransactionRequest;
      expect(service.isOwner(ownerJwt, tx)).toBe(true);
    });

    it('denies non-owner', () => {
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.isOwner(otherJwt, tx)).toBe(false);
      expect(service.canViewFullTransaction(otherJwt, tx)).toBe(false);
    });

    it('allows SUPPORT staff full access to any tx', () => {
      const staff: JwtPayload = { role: UserRole.SUPPORT, ip: '1.1.1.1', account: 99 };
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.canViewFullTransaction(staff, tx)).toBe(true);
      expect(service.isOwner(staff, tx)).toBe(false);
    });

    it('allows COMPLIANCE via SUPPORT hierarchy', () => {
      const staff: JwtPayload = { role: UserRole.COMPLIANCE, ip: '1.1.1.1', account: 99 };
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.canViewFullTransaction(staff, tx)).toBe(true);
    });

    it('allows ADMIN via hierarchy', () => {
      const staff: JwtPayload = { role: UserRole.ADMIN, ip: '1.1.1.1', account: 99 };
      const tx = { userData: { id: 1 } } as Transaction;
      expect(service.canViewFullTransaction(staff, tx)).toBe(true);
    });

    it.each([UserRole.SUPPORT, UserRole.COMPLIANCE, UserRole.ADMIN])(
      'denies %s staff full access without KYC clearance',
      (role) => {
        SetStaffKycClearance([]);
        const staff: JwtPayload = { role, ip: '1.1.1.1', account: 99 };
        const tx = { userData: { id: 1 } } as Transaction;

        // These routes are OptionalJwtAuthGuard-only, so this predicate is the only place the staff KYC
        // gate can apply — without it, an uncleared admin keeps blanket access to every customer's tx.
        expect(service.canViewFullTransaction(staff, tx)).toBe(false);
      },
    );

    it('still allows an uncleared staff member to view their OWN transaction', () => {
      SetStaffKycClearance([]);
      const staff: JwtPayload = { role: UserRole.ADMIN, ip: '1.1.1.1', account: 99 };
      const tx = { userData: { id: 99 } } as Transaction;

      expect(service.canViewFullTransaction(staff, tx)).toBe(true);
    });

    it('denies REALUNIT ownership-independent full access (isolated external tenant, not DFX staff)', () => {
      const tenantStaff: JwtPayload = { role: UserRole.REALUNIT, ip: '1.1.1.1', account: 99 };
      const tx = { userData: { id: 1 } } as Transaction; // not owned by the RealUnit tenant account
      expect(service.canViewFullTransaction(tenantStaff, tx)).toBe(false);
    });

    it('returns false for missing tx', () => {
      expect(service.canViewFullTransaction(ownerJwt, undefined)).toBe(false);
    });

    it('extracts account from Transaction.userData.id via isOwner', () => {
      const tx = { userData: { id: 5 } } as Transaction;
      const jwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 5 };
      expect(service.isOwner(jwt, tx)).toBe(true);
      expect(service.canViewFullTransaction(jwt, tx)).toBe(true);
    });

    it('extracts account from TransactionRequest.user.userData.id via isOwner', () => {
      const tx = { user: { userData: { id: 7 } } } as TransactionRequest;
      const jwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 7 };
      expect(service.isOwner(jwt, tx)).toBe(true);
      expect(service.canViewFullTransaction(jwt, tx)).toBe(true);
    });

    it('denies ownership when tx has no account linkage', () => {
      const jwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 1 };
      expect(service.isOwner(jwt, {} as Transaction)).toBe(false);
      expect(service.canViewFullTransaction(jwt, {} as Transaction)).toBe(false);
    });
  });
});
