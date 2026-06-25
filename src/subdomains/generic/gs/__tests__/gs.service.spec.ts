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
