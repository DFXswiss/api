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

describe('GsService', () => {
  let service: GsService;
  let dataSource: DataSource;
  let appInsightsQueryService: AppInsightsQueryService;

  beforeEach(() => {
    dataSource = createMock<DataSource>();
    appInsightsQueryService = createMock<AppInsightsQueryService>();

    service = new GsService(
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
      createMock<KycDocumentService>(),
      createMock<TransactionService>(),
      createMock<KycAdminService>(),
      createMock<BankDataService>(),
      createMock<NotificationService>(),
      createMock<LimitRequestService>(),
      createMock<SupportIssueService>(),
      createMock<SwapService>(),
      createMock<VirtualIbanService>(),
    );
  });

  describe('executeDebugQuery - Security Validation', () => {
    describe('MSSQL syntax rejection', () => {
      // FOR XML/JSON, TOP etc. are MSSQL-only syntax
      // and will be rejected by the PostgreSQL parser as invalid SQL
      it.each([
        ['SELECT * FROM "user" FOR XML AUTO', 'FOR XML'],
        ['SELECT * FROM "user" FOR JSON PATH', 'FOR JSON'],
        ['SELECT TOP 10 id FROM "user"', 'TOP clause'],
      ])('should reject MSSQL syntax: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow('Invalid SQL syntax');
      });
    });

    describe('Dangerous functions', () => {
      it.each([
        ["SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1')", 'OPENROWSET'],
        ["SELECT * FROM OPENQUERY(LinkedServer, 'SELECT 1')", 'OPENQUERY'],
      ])('should block dangerous function: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('Statement type validation', () => {
      it.each([
        ['INSERT INTO "user" VALUES (1)', 'INSERT'],
        ['UPDATE "user" SET status = 1', 'UPDATE'],
        ['DELETE FROM "user"', 'DELETE'],
        ['DROP TABLE "user"', 'DROP'],
      ])('should block non-SELECT: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block multiple statements', async () => {
        const sql = 'SELECT * FROM "user"; SELECT * FROM user_data';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow('Only single statements allowed');
      });
    });

    describe('Blocked columns (PII protection)', () => {
      it.each([
        ['SELECT mail FROM user_data', 'mail'],
        ['SELECT firstname FROM user_data', 'firstname'],
        ['SELECT surname FROM user_data', 'surname'],
        ['SELECT phone FROM user_data', 'phone'],
        ['SELECT mail AS m FROM user_data', 'aliased mail'],
        ['SELECT firstname, surname FROM user_data', 'multiple PII columns'],
      ])('should block PII column access: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(/Access to column .* is not allowed/);
      });

      it('should block PII in subqueries', async () => {
        const sql = 'SELECT id, (SELECT mail FROM user_data WHERE id = 1) FROM "user"';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('Whole-row references (bypass of per-column masking)', () => {
      // Regression coverage for the to_jsonb/row-reference bypass:
      // any expression that yields a whole row would pass per-column checks (because the
      // parser reports a wildcard or a bare alias) and slip past the post-execution masker
      // (which only walks top-level keys, not nested JSON / tuple-text). Reject pre-execution.
      it.each([
        ['SELECT to_jsonb(ud.*) FROM user_data ud', 'to_jsonb wildcard'],
        ['SELECT to_jsonb(ud) FROM user_data ud', 'to_jsonb bare alias'],
        ['SELECT to_json(ud) FROM user_data ud', 'to_json bare alias'],
        ['SELECT row_to_json(ud.*) FROM user_data ud', 'row_to_json wildcard'],
        ['SELECT row_to_json(ud) FROM user_data ud', 'row_to_json bare alias'],
        ['SELECT jsonb_agg(ud) FROM user_data ud', 'jsonb_agg'],
        ['SELECT array_to_json(array_agg(ud)) FROM user_data ud', 'array_to_json + array_agg'],
        ['SELECT ud FROM user_data ud', 'bare row reference via alias'],
        ['SELECT user_data FROM user_data', 'bare row reference via table name'],
        ['SELECT ud::text FROM user_data ud', 'row cast to text'],
        ['SELECT CAST(ud AS text) FROM user_data ud', 'row CAST to text'],
        ['SELECT * FROM (SELECT to_jsonb(ud.*) AS j FROM user_data ud) sub', 'subquery wrapping'],
        ['WITH x AS (SELECT to_jsonb(ud.*) AS j FROM user_data ud) SELECT * FROM x', 'CTE wrapping'],
      ])('should block whole-row reference: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(/Whole-row reference/);
      });

      it('should allow whole-row reference on a table with no blocked columns', async () => {
        // `asset` has no entries in DebugBlockedCols → row references are harmless.
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ to_jsonb: { id: 1 } }]);
        const result = await service.executeDebugQuery('SELECT to_jsonb(a.*) FROM asset a LIMIT 1', 'test-user');
        expect(result).toBeDefined();
      });
    });

    describe('Blocked schemas', () => {
      it.each([
        ['SELECT * FROM pg_catalog.pg_roles', 'pg_catalog schema'],
        ['SELECT * FROM information_schema.tables', 'information_schema'],
      ])('should block system schema access: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block sys schema in HAVING subquery', async () => {
        const sql = 'SELECT COUNT(*) FROM "user" GROUP BY status HAVING (SELECT 1 FROM information_schema.tables) = 1';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block sys schema in ORDER BY subquery', async () => {
        const sql = 'SELECT * FROM "user" ORDER BY (SELECT 1 FROM information_schema.tables)';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block sys schema in GROUP BY subquery', async () => {
        const sql = 'SELECT COUNT(*) FROM "user" GROUP BY (SELECT 1 FROM information_schema.tables)';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block sys schema in CTE', async () => {
        const sql = 'WITH cte AS (SELECT * FROM information_schema.tables) SELECT * FROM cte';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block sys schema in JOIN ON subquery', async () => {
        const sql = 'SELECT * FROM "user" u JOIN "order" o ON o.id = (SELECT 1 FROM information_schema.tables)';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('UNION/INTERSECT/EXCEPT', () => {
      it('should block UNION queries', async () => {
        const sql = 'SELECT id FROM "user" UNION SELECT id FROM user_data';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(
          'UNION/INTERSECT/EXCEPT queries not allowed',
        );
      });
    });

    describe('SELECT INTO', () => {
      it('should block SELECT INTO', async () => {
        const sql = 'SELECT * INTO temp FROM "user"';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow('SELECT INTO not allowed');
      });
    });

    describe('Valid queries', () => {
      it('should allow SELECT on non-PII columns', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1, status: 'Active' }]);

        const result = await service.executeDebugQuery('SELECT id, status FROM "user"', 'test-user');

        expect(result).toEqual([{ id: 1, status: 'Active' }]);
        expect(dataSource.query).toHaveBeenCalled();
      });

      it('should allow SELECT with LIMIT clause', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

        const result = await service.executeDebugQuery('SELECT id FROM "user" LIMIT 10', 'test-user');

        expect(result).toBeDefined();
      });

      it('should allow SELECT with WHERE clause', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

        const result = await service.executeDebugQuery('SELECT id FROM "user" WHERE status = \'Active\'', 'test-user');

        expect(result).toBeDefined();
      });
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
