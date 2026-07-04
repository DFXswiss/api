import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UpdateTransactionDto } from '../../dto/update-transaction.dto';
import { Transaction } from '../../entities/transaction.entity';
import { TransactionRepository } from '../../repositories/transaction.repository';
import { SpecialExternalAccountService } from '../special-external-account.service';
import { TransactionService } from '../transaction.service';

describe('TransactionService (admin door — amlCheck audit trail)', () => {
  let service: TransactionService;

  let repo: TransactionRepository;
  let userDataService: UserDataService;
  let bankDataService: BankDataService;
  let specialExternalAccountService: SpecialExternalAccountService;
  let buyCryptoRepo: BuyCryptoRepository;
  let transactionAmlCheckService: TransactionAmlCheckService;

  beforeEach(async () => {
    repo = createMock<TransactionRepository>();
    userDataService = createMock<UserDataService>();
    bankDataService = createMock<BankDataService>();
    specialExternalAccountService = createMock<SpecialExternalAccountService>();
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    transactionAmlCheckService = createMock<TransactionAmlCheckService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: TransactionRepository, useValue: repo },
        { provide: UserDataService, useValue: userDataService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: SpecialExternalAccountService, useValue: specialExternalAccountService },
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('records a TX_ADMIN history row when the admin update changes amlCheck', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, amlCheck: CheckStatus.PENDING, highRisk: false });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.update(99, Object.assign(new UpdateTransactionDto(), { amlCheck: CheckStatus.PASS }));

    expect(transactionAmlCheckService.create).toHaveBeenCalledTimes(1);
    expect(transactionAmlCheckService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Transaction',
        entityId: 99,
        source: AmlSourceType.TX_ADMIN,
        previousAmlCheck: CheckStatus.PENDING,
        amlCheck: CheckStatus.PASS,
      }),
    );
  });

  it('does NOT record a history row when the admin update leaves amlCheck unchanged (non-AML field)', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, amlCheck: CheckStatus.PASS, highRisk: false });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    // Only a non-AML field changes. Pass a partial with just that field (as production does — the
    // ValidationPipe uses exposeUnsetFields:false, so absent fields never reach updateInternal); a
    // `new UpdateTransactionDto()` would carry every field as an own `undefined` (target es2023 defines
    // class fields) and wipe amlCheck via updateInternal's Object.assign, which does not happen in prod.
    await service.update(99, { assets: 'BTC-EUR' } as UpdateTransactionDto);

    expect(transactionAmlCheckService.create).not.toHaveBeenCalled();
  });

  it('does NOT record a history row when ONLY amlType / highRisk change but amlCheck does not (table has no amlType column)', async () => {
    const entity = Object.assign(new Transaction(), {
      id: 99,
      amlCheck: CheckStatus.PASS,
      amlType: 'BuyCrypto',
      highRisk: false,
    });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    // Partial with only the fields the admin actually changed (see the note above on exposeUnsetFields).
    await service.update(99, { amlType: 'BuyFiat', highRisk: true } as UpdateTransactionDto);

    expect(transactionAmlCheckService.create).not.toHaveBeenCalled();
  });
});
