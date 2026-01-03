import { BadRequestException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { DataSource } from 'typeorm';
import { AppInsightsQueryService } from 'src/integration/infrastructure/app-insights-query.service';
import { GsService } from '../gs.service';
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

  beforeEach(() => {
    dataSource = createMock<DataSource>();

    service = new GsService(
      createMock<AppInsightsQueryService>(),
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
    describe('FOR XML/JSON blocking', () => {
      it.each([
        ['SELECT * FROM [user] FOR XML AUTO', 'standard FOR XML'],
        ['SELECT * FROM [user] FOR JSON PATH', 'standard FOR JSON'],
        ['SELECT * FROM [user] FOR/**/XML AUTO', 'block comment bypass attempt'],
        ['SELECT * FROM [user] FOR\tXML AUTO', 'tab bypass attempt'],
        ['SELECT * FROM [user] FOR\nXML AUTO', 'newline bypass attempt'],
        ['SELECT * FROM [user] FOR  XML AUTO', 'double-space bypass attempt'],
        ['SELECT * FROM [user] FOR -- comment\nXML AUTO', 'inline comment bypass attempt'],
      ])('should block: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow('FOR XML/JSON not allowed');
      });

      it('should NOT block FOR XML in string literals (no false positives)', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ label: 'FOR XML' }]);

        const result = await service.executeDebugQuery("SELECT 'FOR XML' as label FROM [user]", 'test-user');

        expect(result).toBeDefined();
      });
    });

    describe('Statement type validation', () => {
      it.each([
        ['INSERT INTO [user] VALUES (1)', 'INSERT'],
        ['UPDATE [user] SET status = 1', 'UPDATE'],
        ['DELETE FROM [user]', 'DELETE'],
        ['DROP TABLE [user]', 'DROP'],
      ])('should block non-SELECT: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });

      it('should block multiple statements', async () => {
        const sql = 'SELECT * FROM [user]; SELECT * FROM user_data';
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
        const sql = 'SELECT id, (SELECT mail FROM user_data WHERE id = 1) FROM [user]';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('Blocked schemas', () => {
      it.each([
        ['SELECT * FROM sys.sql_logins', 'sys schema'],
        ['SELECT * FROM INFORMATION_SCHEMA.TABLES', 'INFORMATION_SCHEMA'],
        ['SELECT * FROM master.dbo.sysdatabases', 'master database'],
      ])('should block system schema access: %s (%s)', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('Dangerous functions', () => {
      it.each([
        ["SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1')", 'OPENROWSET'],
        ["SELECT * FROM OPENQUERY(LinkedServer, 'SELECT 1')", 'OPENQUERY'],
        ["SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x;').db.schema.table", 'OPENDATASOURCE'],
      ])('should block dangerous function: %s', async (sql) => {
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(BadRequestException);
      });
    });

    describe('UNION/INTERSECT/EXCEPT', () => {
      it('should block UNION queries', async () => {
        const sql = 'SELECT id FROM [user] UNION SELECT id FROM user_data';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow(
          'UNION/INTERSECT/EXCEPT queries not allowed',
        );
      });
    });

    describe('SELECT INTO', () => {
      it('should block SELECT INTO', async () => {
        const sql = 'SELECT * INTO #temp FROM [user]';
        await expect(service.executeDebugQuery(sql, 'test-user')).rejects.toThrow('SELECT INTO not allowed');
      });
    });

    describe('Valid queries', () => {
      it('should allow SELECT on non-PII columns', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1, status: 'Active' }]);

        const result = await service.executeDebugQuery('SELECT id, status FROM [user]', 'test-user');

        expect(result).toEqual([{ id: 1, status: 'Active' }]);
        expect(dataSource.query).toHaveBeenCalled();
      });

      it('should allow SELECT with TOP clause', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

        const result = await service.executeDebugQuery('SELECT TOP 10 id FROM [user]', 'test-user');

        expect(result).toBeDefined();
      });

      it('should allow SELECT with WHERE clause', async () => {
        jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

        const result = await service.executeDebugQuery("SELECT id FROM [user] WHERE status = 'Active'", 'test-user');

        expect(result).toBeDefined();
      });
    });
  });
});
