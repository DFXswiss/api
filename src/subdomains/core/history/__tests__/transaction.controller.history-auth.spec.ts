import { createMock } from '@golevelup/ts-jest';
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import {
  TransactionDto,
  TransactionState,
  TransactionType,
} from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { TransactionController } from '../controllers/transaction.controller';
import { ExportFormat } from '../dto/history-query.dto';
import { HistoryAccessService } from '../services/history-access.service';
import { ExportType, HistoryService } from '../services/history.service';

describe('TransactionController history auth', () => {
  let controller: TransactionController;
  let historyService: jest.Mocked<HistoryService>;
  let historyAccessService: jest.Mocked<HistoryAccessService>;
  let transactionService: jest.Mocked<TransactionService>;
  let buyCryptoWebhookService: jest.Mocked<BuyCryptoWebhookService>;

  const jwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 1, user: 10, address: '0xAAA' };
  const account = { id: 1 } as UserData;

  beforeEach(async () => {
    historyService = createMock<HistoryService>();
    historyAccessService = createMock<HistoryAccessService>();
    transactionService = createMock<TransactionService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionController,
        { provide: HistoryService, useValue: historyService },
        { provide: HistoryAccessService, useValue: historyAccessService },
        { provide: TransactionService, useValue: transactionService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: BuyFiatService, useValue: createMock<BuyFiatService>() },
        { provide: BankDataService, useValue: createMock<BankDataService>() },
        { provide: BankTxService, useValue: createMock<BankTxService>() },
        { provide: FiatService, useValue: createMock<FiatService>() },
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: BuyCryptoService, useValue: createMock<BuyCryptoService>() },
        { provide: TransactionUtilService, useValue: createMock<TransactionUtilService>() },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: BankTxReturnService, useValue: createMock<BankTxReturnService>() },
        { provide: TransactionRequestService, useValue: createMock<TransactionRequestService>() },
        { provide: BankService, useValue: createMock<BankService>() },
        { provide: TransactionHelper, useValue: createMock<TransactionHelper>() },
        { provide: SwissQRService, useValue: createMock<SwissQRService>() },
        { provide: VirtualIbanService, useValue: createMock<VirtualIbanService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get(TransactionController);
  });

  describe('getTransactions', () => {
    it('requires auth via HistoryAccessService and loads history for subject', async () => {
      historyAccessService.resolveListSubject.mockResolvedValue(account);
      historyService.getHistoryForSubject.mockResolvedValue([]);

      const res = {} as any;
      await controller.getTransactions(jwt, undefined, undefined, undefined, { format: ExportFormat.JSON }, res);

      expect(historyAccessService.resolveListSubject).toHaveBeenCalledWith({
        jwt,
        userAddress: undefined,
        apiKey: undefined,
        apiSign: undefined,
        apiTimestamp: undefined,
      });
      expect(historyService.getHistoryForSubject).toHaveBeenCalledWith(
        account,
        expect.objectContaining({ format: ExportFormat.JSON }),
        ExportType.COMPACT,
      );
    });

    it('propagates UnauthorizedException when access is denied', async () => {
      historyAccessService.resolveListSubject.mockRejectedValue(new UnauthorizedException('Authentication required'));

      await expect(
        controller.getTransactions(undefined, undefined, undefined, undefined, {}, {} as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(historyService.getHistoryForSubject).not.toHaveBeenCalled();
    });
  });

  describe('createCsv / CoinTracking / ChainReport', () => {
    it('createCsv authenticates then caches file key', async () => {
      historyAccessService.resolveListSubject.mockResolvedValue(account);
      const stream = { getStream: () => null } as any;
      historyService.getCsvHistoryForSubject.mockResolvedValue(stream);

      const key = await controller.createCsv(jwt, undefined, undefined, undefined, {});
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      expect(historyService.getCsvHistoryForSubject).toHaveBeenCalled();
    });

    it('getCsvCT uses authenticated subject', async () => {
      historyAccessService.resolveListSubject.mockResolvedValue(account);
      historyService.getHistoryForSubject.mockResolvedValue([]);
      const res = { set: jest.fn() } as any;

      await controller.getCsvCT(jwt, 'k', 's', 't', { format: ExportFormat.JSON }, res);
      expect(historyAccessService.resolveListSubject).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'k', apiSign: 's', apiTimestamp: 't' }),
      );
    });

    it('getCsvChainReport uses authenticated subject', async () => {
      historyAccessService.resolveListSubject.mockResolvedValue(account);
      historyService.getHistoryForSubject.mockResolvedValue([]);
      const res = { set: jest.fn() } as any;

      await controller.getCsvChainReport(jwt, undefined, undefined, undefined, { format: ExportFormat.JSON }, res);
      expect(historyService.getHistoryForSubject).toHaveBeenCalledWith(
        account,
        expect.anything(),
        ExportType.CHAIN_REPORT,
      );
    });
  });

  describe('getSingleTransaction', () => {
    const fullDto = Object.assign(new TransactionDto(), {
      uid: 'Tabcdefghijklmnop',
      type: TransactionType.BUY,
      state: TransactionState.COMPLETED,
      chargebackTarget: 'CH9300762011623852957',
      fees: { total: 1 },
      externalTransactionId: 'secret',
      date: new Date(),
    });

    beforeEach(() => {
      const tx = createCustomTransaction({ userData: account as any });
      transactionService.getTransactionByUid = jest.fn().mockResolvedValue(tx);
      // force path through getTransactionByUid
      jest.spyOn(controller as any, 'getTransaction').mockResolvedValue(tx);
      jest.spyOn(controller as any, 'getTransactionDto').mockResolvedValue(fullDto);
    });

    it('returns full dto for owner/staff', async () => {
      historyAccessService.canViewFullTransaction.mockReturnValue(true);

      const result = await controller.getSingleTransaction(jwt, 'Tabcdefghijklmnop');
      expect(result).toBe(fullDto);
      expect(result.chargebackTarget).toBe('CH9300762011623852957');
    });

    it('returns public dto without private fields for anonymous', async () => {
      historyAccessService.canViewFullTransaction.mockReturnValue(false);

      const result = await controller.getSingleTransaction(undefined, 'Tabcdefghijklmnop');
      expect(result.chargebackTarget).toBeUndefined();
      expect((result as TransactionDto).fees).toBeUndefined();
      expect((result as TransactionDto).externalTransactionId).toBeUndefined();
      expect(result.uid).toBe('Tabcdefghijklmnop');
    });
  });
});
