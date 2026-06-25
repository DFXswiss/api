import { BadRequestException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { DataSource } from 'typeorm';
import { AppInsightsQueryService } from 'src/integration/infrastructure/app-insights-query.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { GsService } from '../gs.service';
import { DebugLogQueryTemplates, LogQueryAuditPrefix } from '../dto/gs.dto';
import { LogQueryTemplate } from '../dto/log-query.dto';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { UserService } from '../../user/models/user/user.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { BankTxRepeatService } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { KycDocumentService } from '../../kyc/services/integration/kyc-document.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { KycAdminService } from '../../kyc/services/kyc-admin.service';
import { BankDataService } from '../../user/models/bank-data/bank-data.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LimitRequestService } from 'src/subdomains/supporting/support-issue/services/limit-request.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { Blob } from 'src/integration/infrastructure/azure-storage.service';
import { ConfigService } from 'src/config/config';
import { DebugAggregate, DebugQueryDto, DebugWhereNode, DebugWhereOp } from '../dto/debug-query.dto';

// Shape of a document as it travels through setUserDataDocs (a KycFileBlob with the relevant fields set).
type KycFileDoc = Pick<KycFileBlob, 'path' | 'url' | 'name'> & { created: Date };

// Typed bridge for partial test blobs: setUserDataDocs only reads path/url/name/created off each entry.
function asKycFileBlobs(docs: KycFileDoc[]): KycFileBlob[] {
  return docs as unknown as KycFileBlob[];
}

// A storage blob as returned by AzureStorageService.listBlobs (fed into the real listFilesByPrefix).
function storageBlob(name: string, created: Date): Blob {
  return {
    name,
    url: `https://storage-backend.example/kyc/${name}`,
    contentType: 'application/pdf',
    created,
    updated: created,
    metadata: {},
  };
}

function buildGsService(
  kycDocumentService: KycDocumentService,
  dataSource: DataSource,
  appInsightsQueryService: AppInsightsQueryService = createMock<AppInsightsQueryService>(),
): GsService {
  return new GsService(
    appInsightsQueryService,
    createMock<UserDataService>(),
    createMock<UserService>(),
    createMock<BuyService>(),
    createMock<SellService>(),
    createMock<BuyCryptoService>(),
    createMock<PayInService>(),
    createMock<BuyFiatService>(),
    createMock<RefRewardService>(),
    createMock<BankTxRepeatService>(),
    createMock<BankTxService>(),
    createMock<FiatOutputService>(),
    dataSource,
    kycDocumentService,
    createMock<TransactionService>(),
    createMock<KycAdminService>(),
    createMock<BankDataService>(),
    createMock<NotificationService>(),
    createMock<LimitRequestService>(),
    createMock<SupportIssueService>(),
    createMock<SwapService>(),
    createMock<VirtualIbanService>(),
  );
}

describe('GsService', () => {
  let service: GsService;
  let dataSource: DataSource;
  let appInsightsQueryService: AppInsightsQueryService;
  let kycDocumentService: KycDocumentService;

  beforeEach(() => {
    dataSource = createMock<DataSource>();
    appInsightsQueryService = createMock<AppInsightsQueryService>();
    kycDocumentService = createMock<KycDocumentService>();

    // Reuse the same constructor helper as the round-trip test, passing in the mocks the tests reference.
    service = buildGsService(kycDocumentService, dataSource, appInsightsQueryService);
  });

  // Helper that captures the SQL string and the bound-parameter array passed to the data
  // source. Tests use it to assert what reached Postgres — not just whether the call
  // succeeded, but that user input flowed through parameters rather than the SQL string.
  function spyQuery(rows: Record<string, unknown>[] = []) {
    return jest.spyOn(dataSource, 'query').mockImplementation(async () => rows);
  }

  describe('executeDebugQuery (structured)', () => {
    describe('table allowlist', () => {
      it('runs a basic SELECT against an allowed table', async () => {
        const q = spyQuery([{ id: 1 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };

        const result = await service.executeDebugQuery(dto, 'tester');

        expect(result.keys).toEqual(['id']);
        expect(q).toHaveBeenCalledTimes(1);
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain('FROM "asset"');
        expect(sql).toContain('LIMIT 10');
        expect(params).toEqual([]);
      });

      it('rejects an unknown table', async () => {
        const dto = {
          table: 'pg_catalog_pg_roles',
          select: [{ kind: 'column' as const, column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not allowed/);
      });
    });

    describe('column allowlist', () => {
      it('rejects a column not in the table allowlist (PII)', async () => {
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'column', column: 'mail' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/Column .*not allowed/);
      });

      it.each([
        ['user_data', 'mail'],
        ['user_data', 'firstname'],
        ['user_data', 'phone'],
        ['user', 'signature'],
        ['user', 'apiKeyCT'],
        ['wallet', 'apiKey'],
        ['bank_data', 'iban'],
        ['ip_log', 'ip'],
        ['recommendation', 'recommendedMail'],
      ])('rejects PII column %s.%s', async (table, column) => {
        const dto = { table, select: [{ kind: 'column' as const, column }], limit: 10 };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(BadRequestException);
      });

      it('allows multiple safe columns in a single SELECT', async () => {
        const q = spyQuery([{ id: 1, name: 'BTC', blockchain: 'Bitcoin' }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'name' },
            { kind: 'column', column: 'blockchain' },
          ],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain('"asset"."id"');
        expect(sql).toContain('"asset"."name"');
        expect(sql).toContain('"asset"."blockchain"');
      });
    });

    describe('aggregate selectors', () => {
      it.each([DebugAggregate.COUNT, DebugAggregate.SUM, DebugAggregate.MIN, DebugAggregate.MAX, DebugAggregate.AVG])(
        'emits %s as an aggregate function',
        async (aggregate) => {
          const q = spyQuery();
          const dto: DebugQueryDto = {
            table: 'asset',
            select: [{ kind: 'aggregate', aggregate, column: 'id', as: 'agg' }],
            limit: 10,
          };
          await service.executeDebugQuery(dto, 'tester');
          const sql = q.mock.calls[0][0] as string;
          expect(sql).toContain(`${aggregate.toUpperCase()}("asset"."id")`);
          expect(sql).toContain('AS "agg"');
        },
      );

      it('rejects aggregate over a disallowed column', async () => {
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'aggregate', aggregate: DebugAggregate.MAX, column: 'mail' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/Column .*not allowed/);
      });
    });

    describe('jsonb path selectors', () => {
      it('allows jsonb path on log.message and emits a -> -> ->> chain', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.totalBalanceChf', as: 'chf' },
          ],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`("log"."message")::jsonb`);
        expect(sql).toContain(`-> 'balancesTotal'`);
        expect(sql).toContain(`->> 'totalBalanceChf'`);
        expect(sql).toContain('AS "chf"');
      });

      it('rejects jsonb path on a column not flagged as jsonbColumns', async () => {
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'jsonb', column: 'name', jsonbPath: 'x.y' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/does not support jsonb/);
      });

      it('rejects jsonb path segments with bad characters', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: "balances.'; DROP TABLE log; --" }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/jsonb path segment/);
      });

      it('rejects jsonb path with too many segments', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: 'a.b.c.d.e.f.g.h.i' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/segments/);
      });
    });

    describe('WHERE leaf predicates', () => {
      it('emits = with a bound parameter, not a string interpolation', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: 'Ethereum' },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"asset"."blockchain" = $1`);
        expect(sql).not.toContain("'Ethereum'");
        expect(params).toEqual(['Ethereum']);
      });

      it('emits IN with one placeholder per value', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.IN, value: [1, 2, 3] },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"asset"."id" IN ($1, $2, $3)`);
        expect(params).toEqual([1, 2, 3]);
      });

      it('emits IS NULL / IS NOT NULL without a parameter', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'valid', op: DebugWhereOp.IS_NULL },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"log"."valid" IS NULL`);
        expect(params).toEqual([]);
      });

      it('rejects IS NULL with a value', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'valid', op: DebugWhereOp.IS_NULL, value: 'oops' },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/must not have a value/);
      });

      it('rejects IN with an empty array', async () => {
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.IN, value: [] },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/list size/);
      });

      it('rejects = on a disallowed column (PII)', async () => {
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'mail', op: DebugWhereOp.EQ, value: 'a@b.c' },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/Column .*not allowed/);
      });

      it('rejects an object/array as a scalar value', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'leaf' as const, column: 'id', op: DebugWhereOp.EQ, value: { a: 1 } as never },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/string, number, or boolean/);
      });
    });

    describe('WHERE composition (AND / OR / NOT)', () => {
      it('emits a nested AND/OR expression', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'and',
            children: [
              { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: 'Ethereum' },
              {
                kind: 'or',
                children: [
                  { kind: 'leaf', column: 'type', op: DebugWhereOp.EQ, value: 'Coin' },
                  { kind: 'leaf', column: 'type', op: DebugWhereOp.EQ, value: 'Token' },
                ],
              },
            ],
          },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toMatch(/\(.*"blockchain" = \$1 AND .*"type" = \$2 OR .*"type" = \$3.*\)/);
        expect(params).toEqual(['Ethereum', 'Coin', 'Token']);
      });

      it('emits NOT', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'not',
            child: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: 'X' },
          },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`NOT "asset"."blockchain" = $1`);
        expect(params).toEqual(['X']);
      });

      it('rejects WHERE tree depth above the cap', async () => {
        // Build a chain of 7 nested AND nodes — well above the depth-5 cap.
        let inner: import('../dto/debug-query.dto').DebugWhereNode = {
          kind: 'leaf',
          column: 'id',
          op: DebugWhereOp.EQ,
          value: 1,
        };
        for (let i = 0; i < 7; i++) inner = { kind: 'and', children: [inner] };

        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: inner,
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/max depth/);
      });
    });

    describe('GROUP BY', () => {
      it('emits GROUP BY for allowed columns', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'subsystem' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'n' },
          ],
          groupBy: ['subsystem'],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`GROUP BY "log"."subsystem"`);
      });

      it('rejects GROUP BY on a disallowed column', async () => {
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'column', column: 'id' }],
          groupBy: ['mail'],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/neither an allowed column/);
      });
    });

    describe('ORDER BY (alias and column)', () => {
      it('allows ORDER BY a select alias declared earlier', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'subsystem' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'n' },
          ],
          groupBy: ['subsystem'],
          orderBy: [{ column: 'n', direction: 'DESC' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`ORDER BY "n" DESC`);
      });

      it('allows ORDER BY an allowed column', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          orderBy: [{ column: 'id', direction: 'DESC' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`ORDER BY "log"."id" DESC`);
      });

      it('rejects ORDER BY on a disallowed column', async () => {
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'column', column: 'id' }],
          orderBy: [{ column: 'mail' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/neither an allowed column/);
      });
    });

    describe('LIMIT', () => {
      it('clamps a limit larger than DebugMaxResults', async () => {
        // The DTO validator caps at 10000 before this point — but defense in depth, the
        // service ALSO clamps. Send a value past the DTO check using a cast.
        const q = spyQuery();
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          limit: 99999 as number,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain('LIMIT 10000');
        expect(sql).not.toContain('LIMIT 99999');
      });

      it('emits LIMIT n OFFSET m when offset is present', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 100,
          offset: 50,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain('LIMIT 100 OFFSET 50');
      });
    });

    describe('audit log', () => {
      it('writes a verbose audit log line with caller identifier', async () => {
        const verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation(() => undefined);
        spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, '0xtester');
        const lines = verboseSpy.mock.calls.map((c) => String(c[0]));
        expect(lines.some((l) => l.startsWith('Debug-query by 0xtester:'))).toBe(true);
        verboseSpy.mockRestore();
      });
    });

    // --- A. Per-operator WHERE op coverage ---
    // Every DebugWhereOp enum value gets at least one test that checks the operator appears
    // literally in the SQL and the value(s) reach the parameter array (not the SQL string).
    describe('WHERE op coverage (DebugWhereOp)', () => {
      it.each([
        [DebugWhereOp.EQ, 'Ethereum', `"asset"."blockchain" = $1`],
        [DebugWhereOp.NE, 'Ethereum', `"asset"."blockchain" != $1`],
        [DebugWhereOp.LT, 100, `"asset"."id" < $1`],
        [DebugWhereOp.LE, 100, `"asset"."id" <= $1`],
        [DebugWhereOp.GT, 100, `"asset"."id" > $1`],
        [DebugWhereOp.GE, 100, `"asset"."id" >= $1`],
        [DebugWhereOp.LIKE, 'BTC%', `"asset"."name" LIKE $1`],
        [DebugWhereOp.ILIKE, '%btc%', `"asset"."name" ILIKE $1`],
      ])('emits %s with a bound parameter', async (op, value, fragment) => {
        const q = spyQuery();
        // Pick a column that matches the value type — keeps the test fixture self-consistent
        // even though the service doesn't actually type-check column-vs-value.
        const column = typeof value === 'number' ? 'id' : op.startsWith('I') || op === 'LIKE' ? 'name' : 'blockchain';
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column, op, value },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(fragment);
        expect(params).toEqual([value]);
      });

      it('emits NOT IN with placeholders matching value count', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.NOT_IN, value: [10, 20] },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"asset"."id" NOT IN ($1, $2)`);
        expect(params).toEqual([10, 20]);
      });

      it('emits IS NOT NULL with no parameter', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'valid', op: DebugWhereOp.IS_NOT_NULL },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"log"."valid" IS NOT NULL`);
        expect(params).toEqual([]);
      });

      it('rejects IS NOT NULL with a value', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'valid', op: DebugWhereOp.IS_NOT_NULL, value: 'oops' },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/must not have a value/);
      });

      it('emits boolean parameters for = on a boolean column', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'valid', op: DebugWhereOp.EQ, value: false },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [, params] = q.mock.calls[0];
        expect(params).toEqual([false]);
      });
    });

    // --- B. Default alias behavior ---
    describe('default select alias', () => {
      it('uses the column name as alias for plain columns', async () => {
        const q = spyQuery([{ id: 1 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id']);
        expect(q.mock.calls[0][0]).toContain(`AS "id"`);
      });

      it('synthesizes <fn>_<col> for aggregates without alias', async () => {
        const q = spyQuery([{ count_id: 5 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['count_id']);
        expect(q.mock.calls[0][0]).toContain(`AS "count_id"`);
      });

      it.each([
        [DebugAggregate.SUM, 'amount', 'sum_amount'],
        [DebugAggregate.MIN, 'created', 'min_created'],
        [DebugAggregate.MAX, 'updated', 'max_updated'],
        [DebugAggregate.AVG, 'amount', 'avg_amount'],
      ])('default alias for %s(%s) is %s', async (aggregate, column, expected) => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'bank_tx',
          select: [{ kind: 'aggregate', aggregate, column }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual([expected]);
        expect(q.mock.calls[0][0]).toContain(`AS "${expected}"`);
      });

      it('uses last jsonb-path segment as default alias', async () => {
        const q = spyQuery([{ totalBalanceChf: '100' }]);
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.totalBalanceChf' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['totalBalanceChf']);
        expect(q.mock.calls[0][0]).toContain(`AS "totalBalanceChf"`);
      });

      it('produces duplicate aliases when two plain columns share the same name (no collision check)', async () => {
        // The service does NOT reject duplicate aliases — it just emits the same alias twice.
        // Postgres will throw at execution time; the test pins the current behavior so a future
        // change to collision detection is a visible breaking change.
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'id' },
          ],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id', 'id']);
        // SQL contains two `AS "id"` fragments.
        const sql = q.mock.calls[0][0] as string;
        expect((sql.match(/AS "id"/g) ?? []).length).toBe(2);
      });

      it('produces colliding aliases when explicit `as` shadows an existing default alias', async () => {
        // `id` (plain) and `n as id` (aggregate aliased to `id`) produce duplicate `id` keys.
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'id' },
          ],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id', 'id']);
        const sql = q.mock.calls[0][0] as string;
        expect((sql.match(/AS "id"/g) ?? []).length).toBe(2);
      });

      it('does NOT collide for default-aggregate-alias and plain-column-name (id + count_id)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id' },
          ],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id', 'count_id']);
      });
    });

    // --- C. Boundary values for limit, offset, IN size, WHERE depth ---
    describe('boundary values', () => {
      it('accepts limit=1 (smallest valid)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 1,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 1');
      });

      it('accepts limit=10000 (DTO cap)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10000,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 10000');
      });

      it('emits LIMIT 0 when limit is cast past the DTO @Min(1) check (defense-in-depth gap)', async () => {
        // DTO `@Min(1)` would normally reject limit=0, but the service does NOT re-check it —
        // only `Math.min(dto.limit, DebugMaxResults)` clamps the upper bound. This pins the
        // current behavior so any future floor-guard becomes a visible breaking change.
        const q = spyQuery();
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          limit: 0,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 0');
      });

      it('does not emit OFFSET clause when offset is 0', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
          offset: 0,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain('LIMIT 10');
        expect(sql).not.toContain('OFFSET');
      });

      it('emits OFFSET 1 (smallest non-zero offset)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
          offset: 1,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 10 OFFSET 1');
      });

      it('emits OFFSET 1000000 (DTO cap)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
          offset: 1_000_000,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 10 OFFSET 1000000');
      });

      it('accepts IN list of 1 value (smallest valid)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.IN, value: [42] },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"asset"."id" IN ($1)`);
        expect(params).toEqual([42]);
      });

      it('accepts IN list of 100 values (at the cap)', async () => {
        const q = spyQuery();
        const ids = Array.from({ length: 100 }, (_, i) => i + 1);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.IN, value: ids },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [, params] = q.mock.calls[0];
        expect(params).toHaveLength(100);
      });

      it('rejects IN list of 101 values (one above the cap)', async () => {
        const ids = Array.from({ length: 101 }, (_, i) => i + 1);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.IN, value: ids },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/list size/);
      });

      it('accepts WHERE tree depth exactly 5', async () => {
        // 4 AND wrappers around a leaf — leaf is depth 5.
        let inner: DebugWhereNode = { kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 1 };
        for (let i = 0; i < 4; i++) inner = { kind: 'and', children: [inner] };

        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: inner,
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q).toHaveBeenCalledTimes(1);
      });

      it('rejects WHERE tree depth 6 (one above the cap)', async () => {
        let inner: DebugWhereNode = { kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 1 };
        for (let i = 0; i < 5; i++) inner = { kind: 'and', children: [inner] };
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: inner,
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/max depth/);
      });

      it('rejects a WHERE string value longer than 1024 chars', async () => {
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: 'x'.repeat(1025) },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/max length/);
      });

      it('accepts a WHERE string value exactly 1024 chars long', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: 'x'.repeat(1024) },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q).toHaveBeenCalledTimes(1);
      });
    });

    // --- D. SQL injection probes ---
    // These probes try to smuggle SQL through every string field. With the DTO validation
    // skipped (no validation pipe in unit tests), most of these reach the service-layer
    // allowlist check and bounce off there. The point is to lock in coverage: a regression
    // that loosens the allowlist or skips a check would let one of these through.
    describe('SQL injection probes (allowlist defense)', () => {
      it('rejects table name with semicolon (not in DebugAllowedColumns)', async () => {
        const dto = {
          table: 'asset; DROP TABLE asset;',
          select: [{ kind: 'column' as const, column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not allowed/);
      });

      it('rejects table name with quote+payload', async () => {
        const dto = {
          table: "asset'; DROP",
          select: [{ kind: 'column' as const, column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not allowed/);
      });

      it('rejects column name with semicolon', async () => {
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id; DROP' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not allowed/);
      });

      it('rejects column name with embedded quotes', async () => {
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id"; DROP --' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not allowed/);
      });

      it('rejects jsonb path segment with quote+payload', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: "x.'y; DROP" }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/jsonb path segment/);
      });

      it('rejects groupBy with semicolon', async () => {
        // groupBy on a DTO would be `@Matches(DebugIdentifierRegex)` per-element, but tests
        // bypass the DTO so the bad value reaches `emitDebugGroupOrderIdent`, which falls
        // through to "neither an allowed column nor a select alias".
        const dto = {
          table: 'log',
          select: [{ kind: 'column' as const, column: 'id' }],
          groupBy: ['id;'],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/neither an allowed column/);
      });

      it('rejects orderBy column with semicolon', async () => {
        const dto = {
          table: 'log',
          select: [{ kind: 'column' as const, column: 'id' }],
          orderBy: [{ column: 'id;', direction: 'DESC' as const }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/neither an allowed column/);
      });

      it('binds tab/newline/quote characters as parameter — not interpolated into SQL', async () => {
        // String values flow through `$1` parameter binding, so the pg driver treats any
        // character as data, not SQL. The test asserts the literal characters appear in the
        // params array but NOT in the emitted SQL string.
        const q = spyQuery();
        const payload = "Ethereum'; DROP TABLE --\n\t";
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.EQ, value: payload },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(params).toEqual([payload]);
        expect(sql).not.toContain('DROP');
        expect(sql).not.toContain("'");
      });

      it('rejects jsonb path with a hyphen (DebugIdentifierRegex disallows -)', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: 'foo-bar' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/jsonb path segment/);
      });

      it('rejects jsonb path with leading digit (DebugIdentifierRegex requires letter/underscore start)', async () => {
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: '1foo' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/jsonb path segment/);
      });
    });

    // --- E. WHERE shape / consistency ---
    describe('WHERE node shape ignored fields and missing fields', () => {
      it('emits leaf SQL when leaf node has stray `children` populated (kind wins)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          // The DebugWhereNode union allows children on a leaf; the emitter ignores them.
          where: {
            kind: 'leaf',
            column: 'blockchain',
            op: DebugWhereOp.EQ,
            value: 'X',
            children: [{ kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 99 }],
          } as DebugWhereNode,
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"asset"."blockchain" = $1`);
        expect(params).toEqual(['X']);
      });

      it('emits AND SQL when AND node has stray `column`/`op` populated (kind wins)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'and',
            children: [{ kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 1 }],
            column: 'blockchain',
            op: DebugWhereOp.EQ,
            value: 'IGNORED',
          } as DebugWhereNode,
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`("asset"."id" = $1)`);
        expect(params).toEqual([1]);
      });

      it('emits NOT SQL when NOT node has stray `children` populated (kind wins)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'not',
            child: { kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 1 },
            children: [{ kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 999 }],
          } as DebugWhereNode,
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`(NOT "asset"."id" = $1)`);
        expect(params).toEqual([1]);
      });

      it('rejects leaf node missing column/op', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'leaf' as const },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/leaf WHERE node requires/);
      });

      it('rejects AND node with no children', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'and' as const },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/requires at least one child/);
      });

      it('rejects OR node with no children', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'or' as const },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/requires at least one child/);
      });

      it('rejects NOT node with no child', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'not' as const },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/'not' node requires/);
      });

      it('rejects WHERE node with unknown kind', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'xor' as never } as DebugWhereNode,
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/WHERE kind/);
      });

      it('rejects select item with unknown kind', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'window' as never, column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/select kind/);
      });

      it('counts each leaf toward the predicate cap', async () => {
        // Build a flat AND with 51 leaves — one above DebugQueryMaxPredicates (50).
        const children: DebugWhereNode[] = Array.from({ length: 51 }, (_, i) => ({
          kind: 'leaf' as const,
          column: 'id',
          op: DebugWhereOp.EQ,
          value: i,
        }));
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'and', children },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/max predicates/);
      });
    });

    // --- F. SQL fragment shape assertions ---
    describe('SQL fragment shapes', () => {
      it('column form: SELECT "log"."id" AS "id"', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`SELECT "log"."id" AS "id"`);
      });

      it('aggregate form: COUNT("log"."id") AS "n"', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'n' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`COUNT("log"."id") AS "n"`);
      });

      it('jsonb chain form: ("log"."message")::jsonb -> ... ->> ...', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'jsonb', column: 'message', jsonbPath: 'a.b', as: 'v' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`("log"."message")::jsonb -> 'a' ->> 'b' AS "v"`);
      });

      it('single-leaf WHERE form: WHERE "log"."subsystem" = $1', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'subsystem', op: DebugWhereOp.EQ, value: 'X' },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`WHERE "log"."subsystem" = $1`);
      });

      it('AND of two leaves: ("log"."system" = $1 AND "log"."subsystem" = $2)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'and',
            children: [
              { kind: 'leaf', column: 'system', op: DebugWhereOp.EQ, value: 'A' },
              { kind: 'leaf', column: 'subsystem', op: DebugWhereOp.EQ, value: 'B' },
            ],
          },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`("log"."system" = $1 AND "log"."subsystem" = $2)`);
      });

      it('NOT-wrapped IS NULL: (NOT "log"."valid" IS NULL)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          where: {
            kind: 'not',
            child: { kind: 'leaf', column: 'valid', op: DebugWhereOp.IS_NULL },
          },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`(NOT "log"."valid" IS NULL)`);
      });

      it('GROUP BY emits table-qualified identifier for an allowed column', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'subsystem' }],
          groupBy: ['subsystem'],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`GROUP BY "log"."subsystem"`);
      });

      it('ORDER BY emits unqualified alias when the name resolves to an alias only', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'n' }],
          orderBy: [{ column: 'n', direction: 'DESC' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`ORDER BY "n" DESC`);
      });

      it('limit + offset together: LIMIT 10 OFFSET 20', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
          offset: 20,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`LIMIT 10 OFFSET 20`);
      });

      it('SELECT items are comma-joined in DTO order', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'name' },
          ],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        // `"asset"."id" AS "id", "asset"."name" AS "name"` — the comma between fragments
        // (after the alias) is what makes this a single SELECT.
        expect(sql).toMatch(/"asset"\."id" AS "id", "asset"\."name" AS "name"/);
      });

      it('FROM clause emits double-quoted table identifier', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain(`FROM "user_data"`);
      });

      it('omits WHERE clause when no `where` is provided', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).not.toContain('WHERE');
      });

      it('omits GROUP BY when groupBy is empty array', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          groupBy: [],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).not.toContain('GROUP BY');
      });

      it('omits ORDER BY when orderBy is empty array', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          orderBy: [],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).not.toContain('ORDER BY');
      });

      it('ORDER BY without explicit direction omits ASC/DESC', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          orderBy: [{ column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql).toContain(`ORDER BY "asset"."id"`);
        // No trailing direction keyword.
        expect(sql).not.toMatch(/ORDER BY "asset"\."id" (ASC|DESC)/);
      });
    });

    // --- G. db-debug.sh predefined-query smoke tests ---
    // Re-create the six structured queries db-debug.sh issues (after migrating away from raw
    // SQL) as DTO calls and assert SQL fragments + bound params line up.
    describe('db-debug.sh predefined query shapes', () => {
      it('--anomalies: log + 3 jsonb selects + AND(subsystem, valid=false) + ORDER + LIMIT', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'created' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.totalBalanceChf', as: 'totalchf' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.plusBalanceChf', as: 'pluschf' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.minusBalanceChf', as: 'minuschf' },
            { kind: 'column', column: 'valid' },
          ],
          where: {
            kind: 'and',
            children: [
              { kind: 'leaf', column: 'subsystem', op: DebugWhereOp.EQ, value: 'FinancialDataLog' },
              { kind: 'leaf', column: 'valid', op: DebugWhereOp.EQ, value: false },
            ],
          },
          orderBy: [{ column: 'id', direction: 'DESC' }],
          limit: 20,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q).toHaveBeenCalledTimes(1);
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`FROM "log"`);
        expect(sql).toContain(`AS "totalchf"`);
        expect(sql).toContain(`AS "pluschf"`);
        expect(sql).toContain(`AS "minuschf"`);
        expect(sql).toContain(`"log"."subsystem" = $1`);
        expect(sql).toContain(`"log"."valid" = $2`);
        expect(sql).toContain(`ORDER BY "log"."id" DESC`);
        expect(sql).toContain(`LIMIT 20`);
        expect(params).toEqual(['FinancialDataLog', false]);
      });

      it('--stats: log + groupBy 3 cols + count(*) + ORDER count DESC', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'system' },
            { kind: 'column', column: 'subsystem' },
            { kind: 'column', column: 'severity' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'count' },
          ],
          groupBy: ['system', 'subsystem', 'severity'],
          orderBy: [{ column: 'count', direction: 'DESC' }],
          limit: 1000,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`COUNT("log"."id") AS "count"`);
        expect(sql).toContain(`GROUP BY "log"."system", "log"."subsystem", "log"."severity"`);
        expect(sql).toContain(`ORDER BY "count" DESC`);
        expect(params).toEqual([]);
      });

      it('--balance: log + 3 jsonb selects + leaf subsystem + ORDER + LIMIT', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'created' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.totalBalanceChf', as: 'totalchf' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.plusBalanceChf', as: 'pluschf' },
            { kind: 'jsonb', column: 'message', jsonbPath: 'balancesTotal.minusBalanceChf', as: 'minuschf' },
            { kind: 'column', column: 'valid' },
          ],
          where: { kind: 'leaf', column: 'subsystem', op: DebugWhereOp.EQ, value: 'FinancialDataLog' },
          orderBy: [{ column: 'id', direction: 'DESC' }],
          limit: 20,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"log"."subsystem" = $1`);
        expect(sql).toContain(`ORDER BY "log"."id" DESC`);
        expect(sql).toContain(`LIMIT 20`);
        expect(params).toEqual(['FinancialDataLog']);
      });

      it('--asset-history: log + [id, created, message] + leaf subsystem + ORDER + LIMIT', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'created' },
            { kind: 'column', column: 'message' },
          ],
          where: { kind: 'leaf', column: 'subsystem', op: DebugWhereOp.EQ, value: 'FinancialDataLog' },
          orderBy: [{ column: 'id', direction: 'DESC' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"log"."id" AS "id"`);
        expect(sql).toContain(`"log"."created" AS "created"`);
        expect(sql).toContain(`"log"."message" AS "message"`);
        expect(sql).toContain(`"log"."subsystem" = $1`);
        expect(sql).toContain(`LIMIT 10`);
        expect(params).toEqual(['FinancialDataLog']);
      });

      it('--referral-chain: recommendation + [recommenderId, method, created] + leaf recommendedId', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'recommendation',
          select: [
            { kind: 'column', column: 'recommenderId' },
            { kind: 'column', column: 'method' },
            { kind: 'column', column: 'created' },
          ],
          where: { kind: 'leaf', column: 'recommendedId', op: DebugWhereOp.EQ, value: 370625 },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`FROM "recommendation"`);
        expect(sql).toContain(`"recommendation"."recommendedId" = $1`);
        expect(params).toEqual([370625]);
      });

      it('--referral-tree (status query): user_data + [status, kycStatus] + leaf id', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'user_data',
          select: [
            { kind: 'column', column: 'status' },
            { kind: 'column', column: 'kycStatus' },
          ],
          where: { kind: 'leaf', column: 'id', op: DebugWhereOp.EQ, value: 370625 },
          limit: 10,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`FROM "user_data"`);
        expect(sql).toContain(`"user_data"."id" = $1`);
        expect(params).toEqual([370625]);
      });

      it('--referral-tree (children query): recommendation + [recommendedId] + leaf recommenderId + ORDER created', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'recommendation',
          select: [{ kind: 'column', column: 'recommendedId' }],
          where: { kind: 'leaf', column: 'recommenderId', op: DebugWhereOp.EQ, value: 370625 },
          orderBy: [{ column: 'created' }],
          limit: 1000,
        };
        await service.executeDebugQuery(dto, 'tester');
        const [sql, params] = q.mock.calls[0];
        expect(sql).toContain(`"recommendation"."recommenderId" = $1`);
        expect(sql).toContain(`ORDER BY "recommendation"."created"`);
        expect(params).toEqual([370625]);
      });
    });

    // --- H. Audit log format details ---
    describe('audit log format', () => {
      it('truncates very large DTO JSON in the audit line to 500 chars', async () => {
        const verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation(() => undefined);
        spyQuery();
        // Build an IN list of long string values so the stringified DTO exceeds 500 chars and
        // the service's `.substring(0, 500)` truncation is actually exercised.
        const longValues = Array.from({ length: 50 }, (_, i) => 'value'.repeat(5) + i);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          where: { kind: 'leaf', column: 'blockchain', op: DebugWhereOp.IN, value: longValues },
          limit: 10,
        };
        // Sanity: the raw JSON is already > 500 chars, so the substring slice will trim it.
        expect(JSON.stringify(dto).length).toBeGreaterThan(500);

        await service.executeDebugQuery(dto, '0xtester');
        const auditLine = verboseSpy.mock.calls
          .map((c) => String(c[0]))
          .find((l) => l.startsWith('Debug-query by 0xtester:'));
        expect(auditLine).toBeDefined();
        // Prefix `Debug-query by 0xtester: ` is 25 chars; rest is JSON capped to 500.
        const payloadLen = auditLine!.length - 'Debug-query by 0xtester: '.length;
        expect(payloadLen).toBe(500);
        verboseSpy.mockRestore();
      });

      it('writes an info-level log line when the query throws', async () => {
        const infoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation(() => undefined);
        jest.spyOn(dataSource, 'query').mockImplementation(async () => {
          throw new Error('boom');
        });
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, '0xtester')).rejects.toThrow(/Query execution failed/);
        const lines = infoSpy.mock.calls.map((c) => String(c[0]));
        expect(lines.some((l) => l.startsWith('Debug-query by 0xtester failed:'))).toBe(true);
        expect(lines.some((l) => l.includes('boom'))).toBe(true);
        infoSpy.mockRestore();
      });

      it('audit JSON payload contains the table name', async () => {
        const verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation(() => undefined);
        spyQuery();
        const dto: DebugQueryDto = {
          table: 'log',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        await service.executeDebugQuery(dto, '0xtester');
        const auditLine = verboseSpy.mock.calls
          .map((c) => String(c[0]))
          .find((l) => l.startsWith('Debug-query by 0xtester:'));
        expect(auditLine).toContain('"table":"log"');
        verboseSpy.mockRestore();
      });
    });

    // --- I. Result-row transformation ---
    describe('result transformation', () => {
      it('returns rows as parallel arrays whose order matches the keys array', async () => {
        spyQuery([{ id: 1, n: 5 }]);
        const dto: DebugQueryDto = {
          table: 'log',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'aggregate', aggregate: DebugAggregate.COUNT, column: 'id', as: 'n' },
          ],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id', 'n']);
        expect(result.rows).toEqual([[1, 5]]);
      });

      it('drops row keys not present in the select alias list', async () => {
        spyQuery([{ id: 1, extra: 'leaked' }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id']);
        expect(result.rows).toEqual([[1]]);
      });

      it('emits undefined slot when row is missing a key in the select alias list', async () => {
        spyQuery([{ id: 1 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [
            { kind: 'column', column: 'id' },
            { kind: 'column', column: 'name' },
          ],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id', 'name']);
        expect(result.rows).toEqual([[1, undefined]]);
      });

      it('returns an empty rows array when dataSource.query yields no rows', async () => {
        spyQuery([]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['id']);
        expect(result.rows).toEqual([]);
      });

      it('honours explicit `as` aliases in the keys array', async () => {
        spyQuery([{ aliased: 42 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id', as: 'aliased' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.keys).toEqual(['aliased']);
        expect(result.rows).toEqual([[42]]);
      });

      it('preserves row order returned by dataSource.query', async () => {
        spyQuery([{ id: 3 }, { id: 1 }, { id: 2 }]);
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 10,
        };
        const result = await service.executeDebugQuery(dto, 'tester');
        expect(result.rows).toEqual([[3], [1], [2]]);
      });
    });

    // --- J. LIMIT/OFFSET emission combinations ---
    describe('LIMIT / OFFSET emission', () => {
      it('emits LIMIT only when offset is undefined (no OFFSET clause)', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 5,
        };
        await service.executeDebugQuery(dto, 'tester');
        const sql = q.mock.calls[0][0] as string;
        expect(sql.trimEnd()).toMatch(/LIMIT 5$/);
        expect(sql).not.toContain('OFFSET');
      });

      it('emits LIMIT n OFFSET m when both are positive', async () => {
        const q = spyQuery();
        const dto: DebugQueryDto = {
          table: 'asset',
          select: [{ kind: 'column', column: 'id' }],
          limit: 5,
          offset: 5,
        };
        await service.executeDebugQuery(dto, 'tester');
        expect(q.mock.calls[0][0]).toContain('LIMIT 5 OFFSET 5');
      });
    });

    // The DTO already enforces these shapes through class-validator at the controller
    // boundary, but the service ALSO re-checks them so a future change that weakens or
    // bypasses the DTO can't open an identifier-injection vector. These tests pin that
    // defense-in-depth — if someone removes a service-side check, the test fails before
    // the unprotected interpolation point ships.
    describe('service-side defense-in-depth (post-DTO)', () => {
      it('rejects a malformed `as` alias that would otherwise reach `AS "..."`', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id', as: 'a"; DROP --' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/not a valid identifier/);
      });

      it('rejects an unknown aggregate value that would otherwise reach the function call', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'aggregate' as const, aggregate: 'BOGUS"; DROP --' as never, column: 'id' }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/Aggregate .*not allowed/);
      });

      it('rejects an unknown WHERE op that would otherwise reach the operator slot', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          where: { kind: 'leaf' as const, column: 'id', op: 'BOGUS; DROP --' as never, value: 1 },
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/Operator .*not allowed/);
      });

      it('rejects an invalid ORDER BY direction that would otherwise reach the SQL string', async () => {
        const dto = {
          table: 'asset',
          select: [{ kind: 'column' as const, column: 'id' }],
          orderBy: [{ column: 'id', direction: 'ASC; DROP --' as never }],
          limit: 10,
        };
        await expect(service.executeDebugQuery(dto, 'tester')).rejects.toThrow(/direction .*not allowed/);
      });
    });
  });

  describe('setUserDataDocs - host-stable, path-preserving document URLs', () => {
    // Pin the services host so the host-stability assertions are deterministic and independent of env.
    const SERVICES_HOST = 'https://app.example';
    const rawUrl = (path: string) => `https://storage-backend.example/kyc/${path}`;
    // The host-stable URL keeps the storage backend out and preserves the full storage path verbatim.
    const hostStableUrl = (path: string) => `${SERVICES_HOST}/kyc/${path}`;

    const previousServicesUrl = process.env.SERVICES_URL;

    beforeEach(() => {
      process.env.SERVICES_URL = SERVICES_HOST;
      new ConfigService();
    });

    afterEach(() => {
      // restore the env + Config singleton so the pinned host does not leak into other test blocks
      if (previousServicesUrl === undefined) delete process.env.SERVICES_URL;
      else process.env.SERVICES_URL = previousServicesUrl;
      new ConfigService();
    });

    // Mirrors KycDocumentService.listFilesByPrefix, which maps storage blobs to KycFileBlob with `path: b.name`.
    const blob = (path: string, created: Date): KycFileDoc => ({
      path,
      url: rawUrl(path),
      created,
      name: path.split('/').pop(),
    });

    const personalUser = (id: number): Partial<UserData>[] => [{ id, accountType: AccountType.PERSONAL }];

    function selectDocs(userData: Partial<UserData>[], selectPath: string): KycFileDoc[] {
      return userData[0][selectPath] as KycFileDoc[];
    }

    it('replaces the storage backend host while keeping the full storage path in the URL', async () => {
      jest
        .spyOn(kycDocumentService, 'listFilesByPrefix')
        .mockResolvedValue(
          asKycFileBlobs([
            blob('user/40102/UserNotes/note.pdf', new Date('2024-01-01')),
            blob('user/40102/UserNotes/second.pdf', new Date('2024-01-02')),
          ]),
        );
      jest.spyOn(kycDocumentService, 'toHostStableUrl').mockImplementation((path) => hostStableUrl(path));

      const userData = personalUser(40102);
      await service['setUserDataDocs'](userData as UserData[], ['documents-user.{userData}.UserNotes'], 'ASC');

      const docs = selectDocs(userData, 'documents-user.{userData}.UserNotes');

      for (const doc of docs) {
        // host-stable: no storage backend host, host pinned to the services domain
        expect(doc.url.startsWith(`${SERVICES_HOST}/`)).toBe(true);
        expect(doc.url).not.toContain('storage-backend.example');
        // path-preserving: the storage path is an unaltered substring of the URL
        expect(doc.url).toContain(doc.path);
      }
    });

    // Hard, non-negotiable consumer invariant: downstream sheets extract the file name via
    // `url.split('<scope>/<id>/<type>')[1]`. The host-stable URL MUST keep that working.
    it('keeps the consumer name-parsing invariant url.split("<scope>/<id>/<type>")[1] intact', async () => {
      jest
        .spyOn(kycDocumentService, 'listFilesByPrefix')
        .mockResolvedValue(asKycFileBlobs([blob('user/40102/UserNotes/contract.pdf', new Date('2024-01-01'))]));
      jest.spyOn(kycDocumentService, 'toHostStableUrl').mockImplementation((path) => hostStableUrl(path));

      const userData = personalUser(40102);
      await service['setUserDataDocs'](userData as UserData[], ['documents-user.{userData}.UserNotes'], 'ASC');

      const doc = selectDocs(userData, 'documents-user.{userData}.UserNotes')[0];

      // exactly the split the consuming sheets perform: docPath = "<scope>/<id>/<type>"
      expect(doc.url.split('user/40102/UserNotes')[1]).toBe('/contract.pdf');
    });

    it('filters by storage path, not by the host-stable URL', async () => {
      jest
        .spyOn(kycDocumentService, 'listFilesByPrefix')
        .mockResolvedValue(
          asKycFileBlobs([
            blob('user/1/Identification/ident.pdf', new Date('2024-01-01')),
            blob('user/1/UserInformation/info.pdf', new Date('2024-01-02')),
          ]),
        );
      jest.spyOn(kycDocumentService, 'toHostStableUrl').mockImplementation((path) => hostStableUrl(path));

      const userData = personalUser(1);
      await service['setUserDataDocs'](
        userData as UserData[],
        ['documents-user.{userData}.Identification', 'documents-user.{userData}.UserInformation'],
        'ASC',
      );

      const identDocs = selectDocs(userData, 'documents-user.{userData}.Identification');
      const infoDocs = selectDocs(userData, 'documents-user.{userData}.UserInformation');

      // path-based filtering still partitions the documents correctly despite rewritten URLs
      expect(identDocs.map((d) => d.path)).toEqual(['user/1/Identification/ident.pdf']);
      expect(infoDocs.map((d) => d.path)).toEqual(['user/1/UserInformation/info.pdf']);
      expect(identDocs[0].url).toBe(hostStableUrl('user/1/Identification/ident.pdf'));
      expect(infoDocs[0].url).toBe(hostStableUrl('user/1/UserInformation/info.pdf'));
    });

    // Exercises the actual round-trip without mocking toHostStableUrl: a real KycDocumentService lists
    // storage blobs (whose `b.name` becomes `doc.path`) and rewrites their URL to the host-stable form.
    // Asserts both the host-stability and the path-preserving consumer invariant on the real output.
    it('produces a host-stable, path-preserving URL through the real KycDocumentService (round-trip)', async () => {
      const kycFileService = createMock<KycFileService>();
      const realKycDocumentService = new KycDocumentService(kycFileService);

      const userBlob = storageBlob('user/1/Identification/passport.pdf', new Date('2024-01-01'));
      const spiderBlob = storageBlob('spider/1/Identification/old-passport.pdf', new Date('2024-01-02'));
      jest
        .spyOn(realKycDocumentService['storageService'], 'listBlobs')
        .mockImplementation(async (prefix?: string) =>
          prefix?.startsWith('user/') ? [userBlob] : prefix?.startsWith('spider/') ? [spiderBlob] : [],
        );

      const realService = buildGsService(realKycDocumentService, createMock<DataSource>());

      const userData = personalUser(1);
      // Two disjoint select paths force an empty common prefix, so getAllUserDocuments (user + spider) runs.
      await realService['setUserDataDocs'](
        userData as UserData[],
        ['documents-user.{userData}.Identification', 'documents-spider.{userData}.Identification'],
        'ASC',
      );

      const userDocs = selectDocs(userData, 'documents-user.{userData}.Identification');
      const spiderDocs = selectDocs(userData, 'documents-spider.{userData}.Identification');

      // user blob: host-stable URL with the storage path preserved verbatim
      expect(userDocs.map((d) => d.path)).toEqual(['user/1/Identification/passport.pdf']);
      expect(userDocs[0].url).toBe(hostStableUrl('user/1/Identification/passport.pdf'));
      expect(userDocs[0].url).not.toContain('storage-backend.example');
      expect(userDocs[0].url.split('user/1/Identification')[1]).toBe('/passport.pdf');

      // spider blob is rewritten the same way (no storage backend host, path preserved)
      expect(spiderDocs.map((d) => d.path)).toEqual(['spider/1/Identification/old-passport.pdf']);
      expect(spiderDocs[0].url).toBe(hostStableUrl('spider/1/Identification/old-passport.pdf'));
      expect(spiderDocs[0].url.split('spider/1/Identification')[1]).toBe('/old-passport.pdf');
    });
  });

  describe('LogQueryAuditPrefix sync', () => {
    it('ALL_TRACES template excludes the exact audit prefix that gs.service emits', async () => {
      const verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation(() => undefined);
      jest.spyOn(appInsightsQueryService, 'query').mockResolvedValue({ tables: [{ columns: [], rows: [] }] } as never);

      await service.executeLogQuery({ template: LogQueryTemplate.ALL_TRACES, hours: 1 }, '0xtester');

      // 1) The service emits an audit log that starts with LogQueryAuditPrefix
      const emitted = verboseSpy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(emitted).toContain(`${LogQueryAuditPrefix}0xtester`);
      expect(emitted.startsWith(LogQueryAuditPrefix)).toBe(true);

      // 2) The ALL_TRACES template KQL excludes lines with that exact prefix
      //    (after DfxLogger's "[GsService] " class-context prefix). This binds
      //    service and template via the shared constant — refactoring the
      //    constant will update both sides at once.
      const kql = DebugLogQueryTemplates[LogQueryTemplate.ALL_TRACES].kql;
      expect(kql).toContain(`[GsService] ${LogQueryAuditPrefix}`);

      verboseSpy.mockRestore();
    });
  });
});
