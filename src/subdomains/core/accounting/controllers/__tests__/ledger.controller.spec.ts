import { createMock } from '@golevelup/ts-jest';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LedgerAccountsResponseDto, LedgerLegsResponseDto } from '../../dto/ledger-account.dto';
import { EquityComparisonDto, MarginResponseDto } from '../../dto/ledger-margin.dto';
import {
  LedgerEquityComparisonQuery,
  LedgerLegsQuery,
  LedgerMarginQuery,
  LedgerPeriodQuery,
} from '../../dto/ledger-query.dto';
import { ReconStatusResponseDto, SuspenseResponseDto } from '../../dto/ledger-reconciliation.dto';
import { LedgerQueryService } from '../../services/ledger-query.service';
import { LedgerController } from '../ledger.controller';

describe('LedgerController', () => {
  let controller: LedgerController;
  let ledgerQueryService: LedgerQueryService;

  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-03-31T00:00:00.000Z');

  beforeEach(() => {
    ledgerQueryService = createMock<LedgerQueryService>();
    controller = new LedgerController(ledgerQueryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAccounts', () => {
    it('forwards the period query to getAccounts and returns its result', async () => {
      const response = {} as LedgerAccountsResponseDto;
      const spy = jest.spyOn(ledgerQueryService, 'getAccounts').mockResolvedValue(response);

      const query: LedgerPeriodQuery = { from, to };
      await expect(controller.getAccounts(query)).resolves.toBe(response);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(from, to);
    });

    it('passes undefined boundaries through unchanged', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getAccounts').mockResolvedValue({} as LedgerAccountsResponseDto);

      await controller.getAccounts({});

      expect(spy).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getAccountDetail', () => {
    it('forwards accountId and the legs query (incl. page) to getAccountDetail', async () => {
      const response = {} as LedgerLegsResponseDto;
      const spy = jest.spyOn(ledgerQueryService, 'getAccountDetail').mockResolvedValue(response);

      const query: LedgerLegsQuery = { from, to, page: 2 };
      await expect(controller.getAccountDetail(42, query)).resolves.toBe(response);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(42, from, to, 2);
    });

    it('forwards an undefined page (service default applies downstream)', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getAccountDetail').mockResolvedValue({} as LedgerLegsResponseDto);

      await controller.getAccountDetail(7, {});

      expect(spy).toHaveBeenCalledWith(7, undefined, undefined, undefined);
    });
  });

  describe('getReconStatus', () => {
    it('delegates to getReconStatus without arguments', async () => {
      const response = {} as ReconStatusResponseDto;
      const spy = jest.spyOn(ledgerQueryService, 'getReconStatus').mockResolvedValue(response);

      await expect(controller.getReconStatus()).resolves.toBe(response);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith();
    });
  });

  describe('getSuspense', () => {
    it('delegates to getSuspense without arguments', async () => {
      const response = {} as SuspenseResponseDto;
      const spy = jest.spyOn(ledgerQueryService, 'getSuspense').mockResolvedValue(response);

      await expect(controller.getSuspense()).resolves.toBe(response);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith();
    });
  });

  describe('getMargin', () => {
    it('forwards from/to and resolves dailySample to true when the flag is absent', async () => {
      const response = {} as MarginResponseDto;
      const spy = jest.spyOn(ledgerQueryService, 'getMargin').mockResolvedValue(response);

      const query: LedgerMarginQuery = { from, to };
      await expect(controller.getMargin(query)).resolves.toBe(response);

      expect(spy).toHaveBeenCalledWith(from, to, true);
    });

    it('keeps dailySample true for any value other than the literal "false"', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getMargin').mockResolvedValue({} as MarginResponseDto);

      await controller.getMargin({ dailySample: 'true' });

      expect(spy).toHaveBeenCalledWith(undefined, undefined, true);
    });

    it('resolves dailySample to false only for the literal "false"', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getMargin').mockResolvedValue({} as MarginResponseDto);

      await controller.getMargin({ from, to, dailySample: 'false' });

      expect(spy).toHaveBeenCalledWith(from, to, false);
    });
  });

  describe('getEquityComparison', () => {
    it('forwards from and resolves dailySample to true when the flag is absent', async () => {
      const response = {} as EquityComparisonDto;
      const spy = jest.spyOn(ledgerQueryService, 'getEquityComparison').mockResolvedValue(response);

      const query: LedgerEquityComparisonQuery = { from };
      await expect(controller.getEquityComparison(query)).resolves.toBe(response);

      expect(spy).toHaveBeenCalledWith(from, true);
    });

    it('resolves dailySample to false only for the literal "false"', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getEquityComparison').mockResolvedValue({} as EquityComparisonDto);

      await controller.getEquityComparison({ from, dailySample: 'false' });

      expect(spy).toHaveBeenCalledWith(from, false);
    });

    it('keeps dailySample true for a non-"false" value', async () => {
      const spy = jest.spyOn(ledgerQueryService, 'getEquityComparison').mockResolvedValue({} as EquityComparisonDto);

      await controller.getEquityComparison({ dailySample: 'yes' });

      expect(spy).toHaveBeenCalledWith(undefined, true);
    });
  });

  describe('routing & security metadata', () => {
    const endpoints: { handler: keyof LedgerController; path: string }[] = [
      { handler: 'getAccounts', path: 'ledger/accounts' },
      { handler: 'getAccountDetail', path: 'ledger/accounts/:accountId/legs' },
      { handler: 'getReconStatus', path: 'ledger/reconciliation' },
      { handler: 'getSuspense', path: 'ledger/suspense' },
      { handler: 'getMargin', path: 'ledger/margin' },
      { handler: 'getEquityComparison', path: 'ledger/equity-comparison' },
    ];

    it('is mounted under the dashboard/accounting base path', () => {
      expect(Reflect.getMetadata(PATH_METADATA, LedgerController)).toBe('dashboard/accounting');
    });

    it.each(endpoints)('maps $handler to GET $path', ({ handler, path }) => {
      const fn = LedgerController.prototype[handler];
      expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    });

    it.each(endpoints)('excludes $handler from the public Swagger surface', ({ handler }) => {
      const fn = LedgerController.prototype[handler];
      const excluded = Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, fn);
      expect(excluded).toEqual({ disable: true });
    });

    it.each(endpoints)('guards $handler with AuthGuard, RoleGuard(ADMIN) and UserActiveGuard', ({ handler }) => {
      const fn = LedgerController.prototype[handler];
      const guards = Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[];

      expect(guards).toHaveLength(3);

      // RoleGuard is the only instance-based guard in the chain; it must carry the ADMIN entry role
      const roleGuard = guards.find((g) => (g as { entryRole?: UserRole }).entryRole !== undefined) as {
        entryRole: UserRole;
      };
      expect(roleGuard).toBeDefined();
      expect(roleGuard.entryRole).toBe(UserRole.ADMIN);

      // the remaining two guards are the AuthGuard passport mixin (anonymous Function) and the UserActiveGuardClass
      const guardNames = guards.map((g) => (g as { constructor: { name: string } }).constructor.name);
      expect(guardNames).toContain('RoleGuardClass');
      expect(guardNames).toContain('UserActiveGuardClass');
    });
  });
});
