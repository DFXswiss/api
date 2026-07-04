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
        highRisk: false,
      }),
    );
  });

  it('does NOT record a history row when the admin update leaves amlCheck unchanged (non-AML field)', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, amlCheck: CheckStatus.PASS, highRisk: false });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    // A non-AML admin edit. new UpdateTransactionDto() carries every optional field as an own `undefined`
    // (target es2023), so updateInternal's Object.assign clobbers the entity's amlCheck to undefined while
    // the DB keeps the prior verdict (save skips undefined). The gate keys on dto.amlCheck (the intent),
    // not the clobbered entity, so no phantom "verdict cleared" row is written.
    await service.update(99, Object.assign(new UpdateTransactionDto(), { assets: 'BTC-EUR' }));

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

    // amlType/highRisk change but amlCheck does not — gate keys on dto.amlCheck (undefined here), so no row.
    await service.update(99, Object.assign(new UpdateTransactionDto(), { amlType: 'BuyFiat', highRisk: true }));

    expect(transactionAmlCheckService.create).not.toHaveBeenCalled();
  });
});
