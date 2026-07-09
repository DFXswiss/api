import { NotFoundException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Configuration, ConfigService } from 'src/config/config';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { RealUnitComplianceService } from 'src/subdomains/supporting/realunit/realunit-compliance.service';
import { RealUnitScopeService } from 'src/subdomains/supporting/realunit/realunit-scope.service';

describe('RealUnitComplianceService', () => {
  let service: RealUnitComplianceService;

  let scopeService: DeepMocked<RealUnitScopeService>;
  let userDataService: DeepMocked<UserDataService>;
  let transactionService: DeepMocked<TransactionService>;
  let bankDataService: DeepMocked<BankDataService>;
  let buyService: DeepMocked<BuyService>;
  let sellService: DeepMocked<SellService>;
  let swapService: DeepMocked<SwapService>;
  let virtualIbanService: DeepMocked<VirtualIbanService>;
  let kycService: DeepMocked<KycService>;
  let kycFileService: DeepMocked<KycFileService>;
  let kycLogService: DeepMocked<KycLogService>;
  let kycDocumentService: DeepMocked<KycDocumentService>;
  let supportIssueService: DeepMocked<SupportIssueService>;

  const jwt = { account: 42 } as JwtPayload;

  function newFile(values: Partial<KycFile>): KycFile {
    return Object.assign(new KycFile(), values);
  }

  function newTx(values: Partial<Transaction>): Transaction {
    return Object.assign(new Transaction(), values);
  }

  beforeEach(() => {
    scopeService = createMock<RealUnitScopeService>();
    userDataService = createMock<UserDataService>();
    transactionService = createMock<TransactionService>();
    bankDataService = createMock<BankDataService>();
    buyService = createMock<BuyService>();
    sellService = createMock<SellService>();
    swapService = createMock<SwapService>();
    virtualIbanService = createMock<VirtualIbanService>();
    kycService = createMock<KycService>();
    kycFileService = createMock<KycFileService>();
    kycLogService = createMock<KycLogService>();
    kycDocumentService = createMock<KycDocumentService>();
    supportIssueService = createMock<SupportIssueService>();

    service = new RealUnitComplianceService(
      scopeService,
      userDataService,
      transactionService,
      bankDataService,
      buyService,
      sellService,
      swapService,
      virtualIbanService,
      kycService,
      kycFileService,
      kycLogService,
      kycDocumentService,
      supportIssueService,
    );
  });

  describe('getReducedDossier', () => {
    it('throws NotFound and loads no data for a non-member id (fail-closed tenant isolation)', async () => {
      scopeService.assertCustomer.mockRejectedValue(new NotFoundException('Not found'));

      await expect(service.getReducedDossier(2)).rejects.toBeInstanceOf(NotFoundException);

      expect(userDataService.getUserData).not.toHaveBeenCalled();
      expect(transactionService.getTransactionsByUserDataId).not.toHaveBeenCalled();
      expect(kycFileService.getUserDataKycFiles).not.toHaveBeenCalled();
    });

    it('keeps only REALU/ZCHF transactions and exposes ident + name-check evidence but no notes', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 1 }));
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({
          id: 1,
          uid: 'kyc_ident',
          type: FileType.IDENTIFICATION,
          name: 'id.pdf',
          created: new Date('2025-01-01'),
        }),
        newFile({
          id: 2,
          uid: 'kyc_nc_old',
          type: FileType.NAME_CHECK,
          name: 'nc-old.pdf',
          created: new Date('2025-05-08'),
        }),
        newFile({ id: 3, uid: 'kyc_nc', type: FileType.NAME_CHECK, name: 'nc.pdf', created: new Date('2025-05-13') }),
        newFile({
          id: 4,
          uid: 'kyc_note',
          type: FileType.USER_NOTES,
          name: 'note.pdf',
          created: new Date('2025-06-01'),
        }),
      ]);
      kycService.getStepsByUserData.mockResolvedValue([]);
      transactionService.getTransactionsByUserDataId.mockResolvedValue([
        newTx({ id: 1, buyCrypto: { inputAsset: 'CHF', outputAsset: { name: 'REALU' } } as any }),
        newTx({ id: 2, buyFiat: { inputAsset: 'ZCHF', outputAsset: { name: 'CHF' } } as any }),
        newTx({ id: 3, buyCrypto: { inputAsset: 'CHF', outputAsset: { name: 'BTC' } } as any }),
        newTx({ id: 4 }),
      ]);
      bankDataService.getBankDatasByUserData.mockResolvedValue([]);
      buyService.getUserDataBuys.mockResolvedValue([]);
      sellService.getSellsByUserDataId.mockResolvedValue([]);
      swapService.getSwapsByUserDataId.mockResolvedValue([]);
      virtualIbanService.getVirtualIbansForAccount.mockResolvedValue([]);
      supportIssueService.getIssueEntities.mockResolvedValue([]);

      const dossier = await service.getReducedDossier(1);

      expect(dossier.transactions.map((t) => t.id)).toEqual([1, 2]);
      expect(dossier.kycFiles.map((f) => f.uid)).toEqual(['kyc_ident', 'kyc_nc_old', 'kyc_nc']);
      expect(dossier.checks.identCheck).toMatchObject({ fileUid: 'kyc_ident', fileName: 'id.pdf' });
      expect(dossier.checks.nameCheck).toMatchObject({
        fileUid: 'kyc_nc',
        fileName: 'nc.pdf',
        date: new Date('2025-05-13'),
      });
    });

    it('reports both checks as missing when no ident step and no evidence files exist', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 1 }));
      kycFileService.getUserDataKycFiles.mockResolvedValue([]);
      kycService.getStepsByUserData.mockResolvedValue([]);
      transactionService.getTransactionsByUserDataId.mockResolvedValue([]);
      bankDataService.getBankDatasByUserData.mockResolvedValue([]);
      buyService.getUserDataBuys.mockResolvedValue([]);
      sellService.getSellsByUserDataId.mockResolvedValue([]);
      swapService.getSwapsByUserDataId.mockResolvedValue([]);
      virtualIbanService.getVirtualIbansForAccount.mockResolvedValue([]);
      supportIssueService.getIssueEntities.mockResolvedValue([]);

      const dossier = await service.getReducedDossier(1);

      expect(dossier.checks.identCheck).toBeUndefined();
      expect(dossier.checks.nameCheck).toBeUndefined();
    });
  });

  describe('searchCustomers', () => {
    // Uses a mail key so resolveUserDatas returns on the mail branch before touching Config.formats (which is
    // unset in the jest env); the member-filtering + no-bankTx behaviour under test is independent of the branch.
    it('filters resolved results down to RealUnit members and never exposes a bankTx array', async () => {
      const member = Object.assign(new UserData(), { id: 1, mail: 'a@b.ch' });
      const foreign = Object.assign(new UserData(), { id: 2, mail: 'a@b.ch' });

      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUsersByMail.mockResolvedValue([member, foreign]);

      const result = await service.searchCustomers('a@b.ch');

      expect(userDataService.getUsersByMail).toHaveBeenCalledWith('a@b.ch', false);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
      expect(result[0]).not.toHaveProperty('bankTx');
    });

    it('returns an empty list (fail-closed) when there are no RealUnit customers', async () => {
      scopeService.getCustomerIds.mockResolvedValue([]);

      await expect(service.searchCustomers('a@b.ch')).resolves.toEqual([]);
      expect(userDataService.getUsersByMail).not.toHaveBeenCalled();
    });

    it('lists the complete tenant scope (sorted by id) when no key is given', async () => {
      const memberA = Object.assign(new UserData(), { id: 2, mail: 'a@b.ch' });
      const memberB = Object.assign(new UserData(), { id: 1, mail: 'b@b.ch' });

      scopeService.getCustomerIds.mockResolvedValue([1, 2]);
      userDataService.getUserDataByIds.mockResolvedValue([memberA, memberB]);

      const result = await service.searchCustomers();

      expect(userDataService.getUserDataByIds).toHaveBeenCalledWith([1, 2]);
      expect(result.map((u) => u.id)).toEqual([1, 2]);
      expect(result[0]).not.toHaveProperty('bankTx');
    });

    it('returns an empty list (fail-closed) without a key when there are no RealUnit customers', async () => {
      scopeService.getCustomerIds.mockResolvedValue([]);

      await expect(service.searchCustomers()).resolves.toEqual([]);
      expect(userDataService.getUserDataByIds).not.toHaveBeenCalled();
    });

    it('never queries by id for a numeric key above the integer range', async () => {
      new ConfigService(new Configuration()); // initializes the global Config used by resolveUserDatas

      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUsersByName.mockResolvedValue([]);

      await expect(service.searchCustomers('99999999999')).resolves.toEqual([]);

      expect(userDataService.getUserData).not.toHaveBeenCalled();
      expect(userDataService.getUsersByName).toHaveBeenCalledWith('99999999999');
    });
  });

  describe('downloadCustomerFile', () => {
    it('rejects a disallowed FileType with NotFound and writes no audit log', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      kycFileService.getKycFile.mockResolvedValue(
        newFile({ id: 10, uid: 'kyc_1', type: FileType.USER_NOTES, name: 'note.pdf', userData: { id: 1 } as UserData }),
      );

      await expect(service.downloadCustomerFile(1, 'kyc_1', jwt)).rejects.toBeInstanceOf(NotFoundException);

      expect(kycDocumentService.downloadFile).not.toHaveBeenCalled();
      expect(kycLogService.createKycFileLog).not.toHaveBeenCalled();
    });

    it('rejects a file belonging to another customer with NotFound and writes no audit log', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      kycFileService.getKycFile.mockResolvedValue(
        newFile({
          id: 11,
          uid: 'kyc_2',
          type: FileType.IDENTIFICATION,
          name: 'id.pdf',
          userData: { id: 2 } as UserData,
        }),
      );

      await expect(service.downloadCustomerFile(1, 'kyc_2', jwt)).rejects.toBeInstanceOf(NotFoundException);

      expect(kycDocumentService.downloadFile).not.toHaveBeenCalled();
      expect(kycLogService.createKycFileLog).not.toHaveBeenCalled();
    });

    it('downloads an allowlisted own-customer file and records the audit log with the staff account', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      const kycFile = newFile({
        id: 12,
        uid: 'kyc_3',
        type: FileType.IDENTIFICATION,
        name: 'id.pdf',
        userData,
      });
      const blob: BlobContent = {
        data: Buffer.from('content'),
        contentType: 'application/pdf',
        created: new Date(),
        updated: new Date(),
        metadata: {},
      };

      scopeService.assertCustomer.mockResolvedValue(undefined);
      kycFileService.getKycFile.mockResolvedValue(kycFile);
      kycDocumentService.downloadFile.mockResolvedValue(blob);

      const result = await service.downloadCustomerFile(1, 'kyc_3', jwt);

      expect(kycDocumentService.downloadFile).toHaveBeenCalledWith(
        FileCategory.USER,
        1,
        FileType.IDENTIFICATION,
        'id.pdf',
      );
      expect(kycLogService.createKycFileLog).toHaveBeenCalledTimes(1);
      expect(kycLogService.createKycFileLog).toHaveBeenCalledWith(expect.stringContaining('42'), userData);
      expect(result).toMatchObject({ uid: 'kyc_3', name: 'id.pdf', type: FileType.IDENTIFICATION, content: blob.data });
    });

    it('asserts membership before resolving the file (fail-closed for a non-member id)', async () => {
      scopeService.assertCustomer.mockRejectedValue(new NotFoundException('Not found'));

      await expect(service.downloadCustomerFile(2, 'kyc_x', jwt)).rejects.toBeInstanceOf(NotFoundException);

      expect(kycFileService.getKycFile).not.toHaveBeenCalled();
    });
  });

  describe('downloadCustomerDossier', () => {
    const blob: BlobContent = {
      data: Buffer.from('content'),
      contentType: 'application/pdf',
      created: new Date(),
      updated: new Date(),
      metadata: {},
    };

    it('zips only allowlisted files and records one aggregated audit log', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(userData);
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 1, uid: 'kyc_ident', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
        newFile({ id: 2, uid: 'kyc_nc', type: FileType.NAME_CHECK, name: 'nc.pdf' }),
        newFile({ id: 3, uid: 'kyc_note', type: FileType.USER_NOTES, name: 'note.pdf' }),
      ]);
      kycDocumentService.downloadFile.mockResolvedValue(blob);

      const zipContent = await service.downloadCustomerDossier(1, jwt);

      expect(Buffer.isBuffer(zipContent)).toBe(true);
      expect(kycDocumentService.downloadFile).toHaveBeenCalledTimes(2);
      expect(kycDocumentService.downloadFile).not.toHaveBeenCalledWith(
        FileCategory.USER,
        1,
        FileType.USER_NOTES,
        'note.pdf',
      );
      expect(kycLogService.createKycFileLog).toHaveBeenCalledTimes(1);
      expect(kycLogService.createKycFileLog).toHaveBeenCalledWith(expect.stringContaining('42'), userData);
    });

    it('throws NotFound and writes no audit log when no allowlisted files exist', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 1 }));
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 3, uid: 'kyc_note', type: FileType.USER_NOTES, name: 'note.pdf' }),
      ]);

      await expect(service.downloadCustomerDossier(1, jwt)).rejects.toBeInstanceOf(NotFoundException);

      expect(kycDocumentService.downloadFile).not.toHaveBeenCalled();
      expect(kycLogService.createKycFileLog).not.toHaveBeenCalled();
    });

    it('asserts membership before loading any data (fail-closed for a non-member id)', async () => {
      scopeService.assertCustomer.mockRejectedValue(new NotFoundException('Not found'));

      await expect(service.downloadCustomerDossier(2, jwt)).rejects.toBeInstanceOf(NotFoundException);

      expect(kycFileService.getUserDataKycFiles).not.toHaveBeenCalled();
      expect(kycDocumentService.downloadFile).not.toHaveBeenCalled();
    });
  });
});
