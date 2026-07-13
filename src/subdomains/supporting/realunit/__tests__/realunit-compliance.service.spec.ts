import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Configuration, ConfigService } from 'src/config/config';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import JSZip from 'jszip';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { HoldersDto } from 'src/subdomains/supporting/realunit/dto/realunit.dto';
import {
  REALUNIT_VISIBLE_TX_ASSETS,
  RealUnitComplianceService,
} from 'src/subdomains/supporting/realunit/realunit-compliance.service';
import { RealUnitService } from 'src/subdomains/supporting/realunit/realunit.service';
import { RealUnitScopeService } from 'src/subdomains/supporting/realunit/realunit-scope.service';

describe('RealUnitComplianceService', () => {
  let service: RealUnitComplianceService;

  let scopeService: DeepMocked<RealUnitScopeService>;
  let userDataService: DeepMocked<UserDataService>;
  let userService: DeepMocked<UserService>;
  let realUnitService: DeepMocked<RealUnitService>;
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

  function newStep(values: Partial<KycStep>): KycStep {
    return Object.assign(new KycStep(), values);
  }

  // Balance resolution defaults: the member has no wallet addresses, but the indexer DOES resolve (a single
  // foreign holder keeps the set non-empty) — so members resolve to 0 (holds nothing), not unknown. Share
  // token with 0 decimals.
  function mockEmptyBalances(): void {
    userService.getUsersByUserDataIds.mockResolvedValue([]);
    realUnitService.getHolders.mockResolvedValue({
      holders: [{ address: '0xf000000000000000000000000000000000000000', balance: '0' }],
      pageInfo: { hasNextPage: false },
    } as HoldersDto);
    realUnitService.getRealuAsset.mockResolvedValue({ decimals: 0 } as Asset);
  }

  // Baseline mocks for a dossier of an existing member with no data; tests override what they exercise.
  function mockDossierDefaults(): void {
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
  }

  beforeEach(() => {
    scopeService = createMock<RealUnitScopeService>();
    userDataService = createMock<UserDataService>();
    userService = createMock<UserService>();
    realUnitService = createMock<RealUnitService>();
    mockEmptyBalances();
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
      userService,
      realUnitService,
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

    it('requests transactions asset-filtered in SQL and exposes ident + name-check evidence but no notes', async () => {
      mockDossierDefaults();
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
      transactionService.getTransactionsByUserDataId.mockResolvedValue([
        newTx({ id: 1, buyCrypto: { inputAsset: 'CHF', outputAsset: { name: 'REALU' } as Asset } as BuyCrypto }),
        newTx({ id: 2, buyFiat: { inputAsset: 'ZCHF' } as BuyFiat }),
      ]);

      const dossier = await service.getReducedDossier(1);

      // the asset predicate must run in SQL (take-limit!), not as an in-memory post-filter
      expect(transactionService.getTransactionsByUserDataId).toHaveBeenCalledWith(1, REALUNIT_VISIBLE_TX_ASSETS);
      expect(dossier.transactions.map((t) => t.id)).toEqual([1, 2]);
      expect(dossier.kycFiles.map((f) => f.uid)).toEqual(['kyc_ident', 'kyc_nc_old', 'kyc_nc']);
      expect(dossier.checks.identCheck).toMatchObject({ fileUid: 'kyc_ident', fileName: 'id.pdf' });
      expect(dossier.checks.nameCheck).toMatchObject({
        fileUid: 'kyc_nc',
        fileName: 'nc.pdf',
        date: new Date('2025-05-13'),
      });
    });

    it('reports the completed ident step even when a later follow-up attempt exists', async () => {
      mockDossierDefaults();
      kycService.getStepsByUserData.mockResolvedValue([
        newStep({
          name: KycStepName.IDENT,
          type: KycStepType.SUMSUB_AUTO,
          status: ReviewStatus.COMPLETED,
          sequenceNumber: 0,
          created: new Date('2025-01-01'),
        }),
        // AML-triggered follow-up video ident: same sequenceNumber (own (name, type) group), newer, not completed
        newStep({
          name: KycStepName.IDENT,
          type: KycStepType.SUMSUB_VIDEO,
          status: ReviewStatus.IN_PROGRESS,
          sequenceNumber: 0,
          created: new Date('2025-06-01'),
        }),
      ]);

      const dossier = await service.getReducedDossier(1);

      expect(dossier.checks.identCheck).toMatchObject({
        status: ReviewStatus.COMPLETED,
        type: KycStepType.SUMSUB_AUTO,
        date: new Date('2025-01-01'),
      });
    });

    it('combines the completed ident step with the latest identification file as evidence', async () => {
      mockDossierDefaults();
      kycService.getStepsByUserData.mockResolvedValue([
        newStep({
          name: KycStepName.IDENT,
          type: KycStepType.SUMSUB_AUTO,
          status: ReviewStatus.COMPLETED,
          sequenceNumber: 0,
          created: new Date('2025-01-01'),
        }),
      ]);
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({
          id: 1,
          uid: 'kyc_ident_old',
          type: FileType.IDENTIFICATION,
          name: 'id-old.pdf',
          created: new Date('2025-01-02'),
        }),
        newFile({
          id: 2,
          uid: 'kyc_ident',
          type: FileType.IDENTIFICATION,
          name: 'id.pdf',
          created: new Date('2025-01-05'),
        }),
      ]);

      const dossier = await service.getReducedDossier(1);

      // the normal state of an identified customer: status/type/date come from the step (date precedence: the
      // step wins over the newer file), while fileUid/fileName point at the newest identification file — together.
      expect(dossier.checks.identCheck).toMatchObject({
        status: ReviewStatus.COMPLETED,
        type: KycStepType.SUMSUB_AUTO,
        date: new Date('2025-01-01'),
        fileUid: 'kyc_ident',
        fileName: 'id.pdf',
      });
    });

    it('ignores canceled ident steps and falls back to the latest remaining attempt', async () => {
      mockDossierDefaults();
      kycService.getStepsByUserData.mockResolvedValue([
        newStep({
          name: KycStepName.IDENT,
          type: KycStepType.SUMSUB_AUTO,
          status: ReviewStatus.CANCELED,
          sequenceNumber: 0,
          created: new Date('2025-03-01'),
        }),
        newStep({
          name: KycStepName.IDENT,
          type: KycStepType.SUMSUB_VIDEO,
          status: ReviewStatus.FAILED,
          sequenceNumber: 0,
          created: new Date('2025-02-01'),
        }),
      ]);

      const dossier = await service.getReducedDossier(1);

      expect(dossier.checks.identCheck).toMatchObject({
        status: ReviewStatus.FAILED,
        type: KycStepType.SUMSUB_VIDEO,
      });
    });

    it('reports both checks as missing when no ident step and no evidence files exist', async () => {
      mockDossierDefaults();

      const dossier = await service.getReducedDossier(1);

      expect(dossier.checks.identCheck).toBeUndefined();
      expect(dossier.checks.nameCheck).toBeUndefined();
    });

    it('resolves the member REALU balance in the dossier detail', async () => {
      mockDossierDefaults();
      userService.getUsersByUserDataIds.mockResolvedValue([
        Object.assign(new User(), { address: '0xAaA', userData: { id: 1 } as UserData }),
      ]);
      realUnitService.getHolders.mockResolvedValue({
        holders: [{ address: '0xaaa', balance: '250' }],
        pageInfo: { hasNextPage: false },
      } as HoldersDto);

      const dossier = await service.getReducedDossier(1);

      expect(dossier.balance).toBe(250);
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

    it('sums the indexer balances over all wallet addresses of a member', async () => {
      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUserDataByIds.mockResolvedValue([Object.assign(new UserData(), { id: 1 })]);
      userService.getUsersByUserDataIds.mockResolvedValue([
        Object.assign(new User(), { address: '0xAbC', userData: { id: 1 } as UserData }),
        Object.assign(new User(), { address: '0xDeF', userData: { id: 1 } as UserData }),
      ]);
      realUnitService.getHolders.mockResolvedValue({
        holders: [
          { address: '0xabc', balance: '100' },
          { address: '0xdef', balance: '50' },
          { address: '0x999', balance: '7' }, // foreign holder, not one of the member's addresses
        ],
        pageInfo: { hasNextPage: false },
      } as HoldersDto);

      const result = await service.searchCustomers();

      expect(result[0].balance).toBe(150);
    });

    it('reports the balance as unknown (undefined) when the indexer is unavailable', async () => {
      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUserDataByIds.mockResolvedValue([Object.assign(new UserData(), { id: 1 })]);
      realUnitService.getHolders.mockRejectedValue(new Error('indexer down'));

      const result = await service.searchCustomers();

      expect(result).toHaveLength(1);
      expect(result[0].balance).toBeUndefined();
    });

    it('reports the balance as unknown (undefined) when the indexer resolves but returns no holders', async () => {
      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUserDataByIds.mockResolvedValue([Object.assign(new UserData(), { id: 1 })]);
      userService.getUsersByUserDataIds.mockResolvedValue([
        Object.assign(new User(), { address: '0xabc', userData: { id: 1 } as UserData }),
      ]);
      realUnitService.getHolders.mockResolvedValue({ holders: [], pageInfo: { hasNextPage: false } } as HoldersDto);

      const result = await service.searchCustomers();

      expect(result[0].balance).toBeUndefined();
    });

    it('skips a single unparsable holder balance and still sums the remaining addresses', async () => {
      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUserDataByIds.mockResolvedValue([Object.assign(new UserData(), { id: 1 })]);
      userService.getUsersByUserDataIds.mockResolvedValue([
        Object.assign(new User(), { address: '0xabc', userData: { id: 1 } as UserData }),
        Object.assign(new User(), { address: '0xdef', userData: { id: 1 } as UserData }),
      ]);
      realUnitService.getHolders.mockResolvedValue({
        holders: [
          { address: '0xabc', balance: 'not-a-number' }, // malformed -> skipped, must not blank the batch
          { address: '0xdef', balance: '50' },
        ],
        pageInfo: { hasNextPage: false },
      } as HoldersDto);

      const result = await service.searchCustomers();

      expect(result[0].balance).toBe(50);
    });

    it('reports the balance as unknown (undefined) when the indexer signals another page without a cursor', async () => {
      scopeService.getCustomerIds.mockResolvedValue([1]);
      userDataService.getUserDataByIds.mockResolvedValue([Object.assign(new UserData(), { id: 1 })]);
      userService.getUsersByUserDataIds.mockResolvedValue([
        Object.assign(new User(), { address: '0xabc', userData: { id: 1 } as UserData }),
      ]);
      realUnitService.getHolders.mockResolvedValue({
        holders: [{ address: '0xabc', balance: '100' }],
        pageInfo: { hasNextPage: true },
      } as unknown as HoldersDto);

      const result = await service.searchCustomers();

      expect(result[0].balance).toBeUndefined();
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

    it('serves a NAME_CHECK (Dilisense) file through the single-file download', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      const kycFile = newFile({ id: 13, uid: 'kyc_4', type: FileType.NAME_CHECK, name: 'nc.pdf', userData });
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

      const result = await service.downloadCustomerFile(1, 'kyc_4', jwt);

      expect(result).toMatchObject({ uid: 'kyc_4', name: 'nc.pdf', type: FileType.NAME_CHECK, content: blob.data });
      expect(kycLogService.createKycFileLog).toHaveBeenCalledTimes(1);
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

    async function zipEntries(zipContent: Buffer): Promise<string[]> {
      const zip = await JSZip.loadAsync(zipContent);
      return Object.keys(zip.files)
        .filter((k) => !zip.files[k].dir)
        .sort();
    }

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

      await expect(zipEntries(zipContent)).resolves.toEqual(['Identification/id.pdf', 'NameCheck/nc.pdf']);
      expect(kycDocumentService.downloadFile).toHaveBeenCalledTimes(2);
      expect(kycDocumentService.downloadFile).not.toHaveBeenCalledWith(
        FileCategory.USER,
        1,
        FileType.USER_NOTES,
        'note.pdf',
      );
      expect(kycLogService.createKycFileLog).toHaveBeenCalledTimes(1);
      expect(kycLogService.createKycFileLog).toHaveBeenCalledWith(
        expect.stringContaining('exported files: 1, 2'),
        userData,
      );
    });

    it('lists an unfetchable file in MISSING_FILES.txt and logs exported vs missing ids separately', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(userData);
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 1, uid: 'kyc_ident', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
        newFile({ id: 2, uid: 'kyc_nc', type: FileType.NAME_CHECK, name: 'nc.pdf' }),
      ]);
      kycDocumentService.downloadFile.mockImplementation((_category, _id, type) =>
        type === FileType.NAME_CHECK ? Promise.reject(new Error('storage error')) : Promise.resolve(blob),
      );

      const zipContent = await service.downloadCustomerDossier(1, jwt);

      await expect(zipEntries(zipContent)).resolves.toEqual(['Identification/id.pdf', 'MISSING_FILES.txt']);
      const zip = await JSZip.loadAsync(zipContent);
      await expect(zip.files['MISSING_FILES.txt'].async('string')).resolves.toContain('nc.pdf (ID: 2)');
      expect(kycLogService.createKycFileLog).toHaveBeenCalledWith(
        expect.stringContaining('exported files: 1; not fetchable: 2'),
        userData,
      );
    });

    it('fails the export and writes no audit log when nothing could be fetched', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 1 }));
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 1, uid: 'kyc_ident', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
      ]);
      kycDocumentService.downloadFile.mockRejectedValue(new Error('storage down'));

      await expect(service.downloadCustomerDossier(1, jwt)).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(kycLogService.createKycFileLog).not.toHaveBeenCalled();
    });

    it('sanitizes traversal payloads in entry paths and de-duplicates colliding names', async () => {
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 1 }));
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 1, uid: 'kyc_a', type: FileType.IDENTIFICATION, name: '../../evil.pdf' }),
        newFile({ id: 2, uid: 'kyc_b', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
        newFile({ id: 3, uid: 'kyc_c', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
      ]);
      kycDocumentService.downloadFile.mockResolvedValue(blob);

      const entries = await zipEntries(await service.downloadCustomerDossier(1, jwt));

      expect(entries).toContain('Identification/id.pdf');
      expect(entries).toContain('Identification/3_id.pdf');
      for (const entry of entries) {
        expect(entry).not.toContain('..');
        expect(entry.split('/')).toHaveLength(2); // exactly type/name, no traversal
      }
    });

    it('keeps every file when a collision fallback path itself collides, and the audit log matches the ZIP', async () => {
      const userData = Object.assign(new UserData(), { id: 1 });
      scopeService.assertCustomer.mockResolvedValue(undefined);
      userDataService.getUserData.mockResolvedValue(userData);
      // B's base name collides with A, and the "<id>_" fallback for B then collides with C's real name. The
      // fallback must escalate again instead of overwriting C — otherwise C is dropped from the ZIP while the
      // audit log still lists it as exported.
      kycFileService.getUserDataKycFiles.mockResolvedValue([
        newFile({ id: 5, uid: 'kyc_a', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
        newFile({ id: 99, uid: 'kyc_c', type: FileType.IDENTIFICATION, name: '6_id.pdf' }),
        newFile({ id: 6, uid: 'kyc_b', type: FileType.IDENTIFICATION, name: 'id.pdf' }),
      ]);
      kycDocumentService.downloadFile.mockResolvedValue(blob);

      const entries = await zipEntries(await service.downloadCustomerDossier(1, jwt));

      // all three files survive as distinct entries — none is silently overwritten
      expect(entries).toHaveLength(3);
      expect(new Set(entries).size).toBe(3);
      expect(entries).toContain('Identification/id.pdf'); // A
      expect(entries).toContain('Identification/6_id.pdf'); // C, kept
      // the audit trail must not claim more exported files than the ZIP actually contains
      expect(kycLogService.createKycFileLog).toHaveBeenCalledWith(
        expect.stringContaining('exported files: 5, 99, 6'),
        userData,
      );
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
