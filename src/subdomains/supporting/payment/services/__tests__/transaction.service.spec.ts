import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { AmlSourceType } from 'src/subdomains/core/aml/entities/transaction-aml-check.entity';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { TransactionAmlCheckService } from 'src/subdomains/core/aml/services/transaction-aml-check.service';
import { BuyCryptoBatch } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto-batch.entity';
import { BuyCrypto, BuyCryptoStatus } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CryptoInput, PayInAction } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { Between, EntityManager, In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { UpdateTransactionDto } from '../../dto/update-transaction.dto';
import { TransactionRequest, TransactionRequestType } from '../../entities/transaction-request.entity';
import { Transaction, TransactionSourceType, TransactionTypeInternal } from '../../entities/transaction.entity';
import { TransactionRepository } from '../../repositories/transaction.repository';
import { SpecialExternalAccountService } from '../special-external-account.service';
import { TransactionService } from '../transaction.service';

interface ServiceSetup {
  service: TransactionService;
  repo: TransactionRepository;
  userDataService: UserDataService;
  bankDataService: BankDataService;
  specialExternalAccountService: SpecialExternalAccountService;
  buyCryptoRepo: BuyCryptoRepository;
  transactionAmlCheckService: TransactionAmlCheckService;
}

async function setupService(): Promise<ServiceSetup> {
  const repo = createMock<TransactionRepository>();
  const userDataService = createMock<UserDataService>();
  const bankDataService = createMock<BankDataService>();
  const specialExternalAccountService = createMock<SpecialExternalAccountService>();
  const buyCryptoRepo = createMock<BuyCryptoRepository>();
  const transactionAmlCheckService = createMock<TransactionAmlCheckService>();

  const module: TestingModule = await Test.createTestingModule({
    imports: [TestSharedModule],
    providers: [
      TransactionService,
      { provide: TransactionRepository, useValue: repo },
      { provide: UserDataService, useValue: userDataService },
      { provide: BankDataService, useValue: bankDataService },
      { provide: SpecialExternalAccountService, useValue: specialExternalAccountService },
      { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
      { provide: TransactionAmlCheckService, useValue: transactionAmlCheckService },
      TestUtil.provideConfig(),
    ],
  }).compile();

  return {
    service: module.get<TransactionService>(TransactionService),
    repo,
    userDataService,
    bankDataService,
    specialExternalAccountService,
    buyCryptoRepo,
    transactionAmlCheckService,
  };
}

type QueryBuilderMock = Record<string, jest.Mock>;

// `new Brackets(cb)` only stores the callback, so a mocked query builder has to invoke it itself —
// otherwise the conditions built inside the brackets are never executed.
function applyBrackets(condition: unknown, innerQb: QueryBuilderMock): void {
  if (condition && typeof condition === 'object' && 'whereFactory' in condition) {
    (condition as { whereFactory: (qb: QueryBuilderMock) => void }).whereFactory(innerQb);
  }
}

const CHAINING_METHODS = ['select', 'addSelect', 'leftJoin', 'leftJoinAndSelect', 'orderBy', 'groupBy'];
const CONDITION_METHODS = ['where', 'andWhere', 'orWhere'];

// `terminals` maps the result-producing methods (getMany, getOne, getRawOne, getRawMany) to their value.
function createQueryBuilderMock(terminals: Record<string, unknown>): {
  qb: QueryBuilderMock;
  innerQb: QueryBuilderMock;
} {
  const innerQb: QueryBuilderMock = Object.fromEntries(
    CONDITION_METHODS.map((method) => [method, jest.fn(() => innerQb)]),
  );

  const qb: QueryBuilderMock = Object.fromEntries([
    ...CHAINING_METHODS.map((method) => [method, jest.fn(() => qb)]),
    ...CONDITION_METHODS.map((method) => [
      method,
      jest.fn((condition: unknown) => {
        applyBrackets(condition, innerQb);
        return qb;
      }),
    ]),
    ...Object.entries(terminals).map(([method, value]) => [method, jest.fn().mockResolvedValue(value)]),
  ]);

  return { qb, innerQb };
}

describe('TransactionService (admin door — amlCheck audit trail)', () => {
  let service: TransactionService;

  let repo: TransactionRepository;
  let userDataService: UserDataService;
  let bankDataService: BankDataService;
  let specialExternalAccountService: SpecialExternalAccountService;
  let buyCryptoRepo: BuyCryptoRepository;
  let transactionAmlCheckService: TransactionAmlCheckService;

  beforeEach(async () => {
    ({
      service,
      repo,
      userDataService,
      bankDataService,
      specialExternalAccountService,
      buyCryptoRepo,
      transactionAmlCheckService,
    } = await setupService());
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

  it('takes the highRisk flag from the dto when the admin sets it alongside the verdict', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, amlCheck: CheckStatus.PENDING, highRisk: false });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.update(99, Object.assign(new UpdateTransactionDto(), { amlCheck: CheckStatus.FAIL, highRisk: true }));

    expect(transactionAmlCheckService.create).toHaveBeenCalledWith(
      expect.objectContaining({ amlCheck: CheckStatus.FAIL, highRisk: true }),
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

  it('does NOT record a history row when the admin re-submits the verdict the transaction already has', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, amlCheck: CheckStatus.PASS, highRisk: false });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.update(99, Object.assign(new UpdateTransactionDto(), { amlCheck: CheckStatus.PASS }));

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

  it('rejects an update for an unknown transaction', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await expect(service.update(99, new UpdateTransactionDto())).rejects.toThrow('Transaction not found');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('resolves the account of a reassigned transaction and rejects an unknown one', async () => {
    const entity = Object.assign(new Transaction(), { id: 99 });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(null);

    const dto = Object.assign(new UpdateTransactionDto(), { userData: Object.assign(new UserData(), { id: 5 }) });

    await expect(service.update(99, dto)).rejects.toThrow(NotFoundException);
    expect(userDataService.getUserData).toHaveBeenCalledWith(5);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reassigns a transaction without a bank tx without touching bank data', async () => {
    const entity = Object.assign(new Transaction(), { id: 99 });
    const userData = Object.assign(new UserData(), { id: 5 });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

    await service.update(
      99,
      Object.assign(new UpdateTransactionDto(), { userData: Object.assign(new UserData(), { id: 5 }) }),
    );

    expect(entity.userData).toBe(userData);
    expect(bankDataService.getVerifiedBankDataWithIban).not.toHaveBeenCalled();
    expect(bankDataService.createVerifyBankData).not.toHaveBeenCalled();
  });

  it('creates verified bank data when the new account has none for the sender IBAN', async () => {
    const bankTx = Object.assign(new BankTx(), { senderAccount: 'CH00', bic: 'BICBIC' });
    jest.spyOn(bankTx, 'bankDataName').mockReturnValue('ACME AG');
    const entity = Object.assign(new Transaction(), { id: 99, bankTx });
    const userData = Object.assign(new UserData(), { id: 5 });
    const multiAccounts = [];
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);
    jest.spyOn(bankDataService, 'getVerifiedBankDataWithIban').mockResolvedValue(null);
    jest.spyOn(specialExternalAccountService, 'getMultiAccounts').mockResolvedValue(multiAccounts);

    await service.update(
      99,
      Object.assign(new UpdateTransactionDto(), { userData: Object.assign(new UserData(), { id: 5 }) }),
    );

    expect(bankDataService.getVerifiedBankDataWithIban).toHaveBeenCalledWith('CH00', 5);
    expect(bankTx.bankDataName).toHaveBeenCalledWith(multiAccounts);
    expect(bankDataService.createVerifyBankData).toHaveBeenCalledWith(userData, {
      name: 'ACME AG',
      iban: 'CH00',
      bic: 'BICBIC',
      type: BankDataType.BANK_IN,
    });
  });

  it('skips bank data creation when the new account already holds the sender IBAN', async () => {
    const bankTx = Object.assign(new BankTx(), { senderAccount: 'CH00' });
    const entity = Object.assign(new Transaction(), { id: 99, bankTx });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(Object.assign(new UserData(), { id: 5 }));
    jest.spyOn(bankDataService, 'getVerifiedBankDataWithIban').mockResolvedValue(createMock());

    await service.update(
      99,
      Object.assign(new UpdateTransactionDto(), { userData: Object.assign(new UserData(), { id: 5 }) }),
    );

    expect(bankDataService.createVerifyBankData).not.toHaveBeenCalled();
  });

  it('skips bank data creation when the bank tx yields no name to verify', async () => {
    const bankTx = Object.assign(new BankTx(), { senderAccount: 'CH00' });
    jest.spyOn(bankTx, 'bankDataName').mockReturnValue(undefined);
    const entity = Object.assign(new Transaction(), { id: 99, bankTx });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(Object.assign(new UserData(), { id: 5 }));
    jest.spyOn(bankDataService, 'getVerifiedBankDataWithIban').mockResolvedValue(null);
    jest.spyOn(specialExternalAccountService, 'getMultiAccounts').mockResolvedValue([]);

    await service.update(
      99,
      Object.assign(new UpdateTransactionDto(), { userData: Object.assign(new UserData(), { id: 5 }) }),
    );

    expect(bankDataService.createVerifyBankData).not.toHaveBeenCalled();
  });

  it('stops BuyCrypto with a partial conditional update instead of saving a stale snapshot', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 7, status: BuyCryptoStatus.MISSING_LIQUIDITY });
    jest.spyOn(repo, 'findOne').mockResolvedValue(Object.assign(new Transaction(), { id: 70, buyCrypto }));
    jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.stop(70);

    expect(buyCryptoRepo.update).toHaveBeenCalledWith(
      { id: 7, status: BuyCryptoStatus.MISSING_LIQUIDITY },
      { status: BuyCryptoStatus.STOPPED },
    );
    expect(buyCryptoRepo.save).not.toHaveBeenCalled();
  });

  it('rejects stop when a concurrent AML reset changed the BuyCrypto status', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 7, status: BuyCryptoStatus.MISSING_LIQUIDITY });
    jest.spyOn(repo, 'findOne').mockResolvedValue(Object.assign(new Transaction(), { id: 70, buyCrypto }));
    jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

    await expect(service.stop(70)).rejects.toThrow(ConflictException);
    expect(buyCryptoRepo.save).not.toHaveBeenCalled();
  });

  it('rejects stop for an unknown transaction', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await expect(service.stop(70)).rejects.toThrow(NotFoundException);
    expect(buyCryptoRepo.update).not.toHaveBeenCalled();
  });

  it('rejects stop for a completed transaction', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 7, status: BuyCryptoStatus.COMPLETE });
    const entity = Object.assign(new Transaction(), { id: 70, buyCrypto, outputDate: new Date() });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);

    await expect(service.stop(70)).rejects.toThrow(BadRequestException);
    expect(buyCryptoRepo.update).not.toHaveBeenCalled();
  });

  it('rejects stop for a transaction that is not a BuyCrypto', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(Object.assign(new Transaction(), { id: 70 }));

    await expect(service.stop(70)).rejects.toThrow(BadRequestException);
    expect(buyCryptoRepo.update).not.toHaveBeenCalled();
  });

  it('rejects stop for an already stopped transaction', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 7, status: BuyCryptoStatus.STOPPED });
    jest.spyOn(repo, 'findOne').mockResolvedValue(Object.assign(new Transaction(), { id: 70, buyCrypto }));

    await expect(service.stop(70)).rejects.toThrow(BadRequestException);
    expect(buyCryptoRepo.update).not.toHaveBeenCalled();
  });

  function mockResumeManager(
    buyCrypto: BuyCrypto | null,
    updateResult = { affected: 1, raw: [], generatedMaps: [] },
    locked: { checkoutTx?: CheckoutTx; cryptoInput?: CryptoInput } = {},
  ) {
    const manager = {
      findOne: jest.fn().mockImplementation(async (entityClass: unknown) => {
        if (entityClass === BuyCrypto) return buyCrypto;
        if (entityClass === CheckoutTx) return locked.checkoutTx ?? buyCrypto?.checkoutTx ?? null;
        if (entityClass === CryptoInput) return locked.cryptoInput ?? buyCrypto?.cryptoInput ?? null;
        return null;
      }),
      update: jest.fn().mockResolvedValue(updateResult),
    };
    // The auto-mocked repository has no `manager` getter to spy on, so define the property outright.
    Object.defineProperty(buyCryptoRepo, 'manager', {
      configurable: true,
      value: { transaction: (cb: (m: typeof manager) => unknown) => cb(manager) } as unknown as EntityManager,
    });
    return manager;
  }

  it('resume() sets a stopped BuyCrypto back to Created via a targeted update', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await service.resume(99);

    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ relations: { buyCrypto: true } }));
    expect(manager.update).toHaveBeenCalledWith(
      BuyCrypto,
      {
        id: 7,
        status: BuyCryptoStatus.STOPPED,
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        batch: IsNull(),
        txId: IsNull(),
        outputAmount: IsNull(),
        chargebackOutput: IsNull(),
        chargebackAllowedDate: IsNull(),
        chargebackAllowedDateUser: IsNull(),
        chargebackDate: IsNull(),
        chargebackCryptoTxId: IsNull(),
        chargebackBankTx: IsNull(),
      },
      { status: BuyCryptoStatus.CREATED },
    );
  });

  it('resume() rejects a transaction that is not stopped', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.COMPLETE,
      amlCheck: CheckStatus.PASS,
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction whose amlCheck is not Pass', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.FAIL,
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a transaction without buyCrypto', async () => {
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto: undefined });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(null);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects an unknown transaction', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);
    const manager = mockResumeManager(null);

    await expect(service.resume(99)).rejects.toThrow(NotFoundException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when the BuyCrypto disappeared between the transaction read and the lock', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 7, status: BuyCryptoStatus.STOPPED });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(null);

    await expect(service.resume(99)).rejects.toThrow(NotFoundException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction that is already assigned to a batch', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      batch: Object.assign(new BuyCryptoBatch(), { id: 1 }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction with an existing payout txId', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      txId: '0xabc',
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction with a chargeback in progress', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      chargebackAllowedDateUser: new Date(),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction whose checkout payment was refunded', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      checkoutTx: Object.assign(new CheckoutTx(), { id: 3, status: CheckoutPaymentStatus.REFUNDED }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects a stopped transaction whose crypto input is being returned', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      cryptoInput: Object.assign(new CryptoInput(), { id: 4, action: PayInAction.RETURN }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when the checkout refund commits between the read and the lock', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      checkoutTx: Object.assign(new CheckoutTx(), { id: 3, status: CheckoutPaymentStatus.PAID }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(
      buyCrypto,
      { affected: 1, raw: [], generatedMaps: [] },
      {
        checkoutTx: Object.assign(new CheckoutTx(), { id: 3, status: CheckoutPaymentStatus.REFUNDED }),
      },
    );

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when the crypto return starts between the read and the lock', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      cryptoInput: Object.assign(new CryptoInput(), { id: 4 }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(
      buyCrypto,
      { affected: 1, raw: [], generatedMaps: [] },
      {
        cryptoInput: Object.assign(new CryptoInput(), { id: 4, action: PayInAction.RETURN }),
      },
    );

    await expect(service.resume(99)).rejects.toThrow(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('resume() drops relations that vanished under the lock instead of resuming on a stale copy', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
      checkoutTx: Object.assign(new CheckoutTx(), { id: 3, status: CheckoutPaymentStatus.PAID }),
      cryptoInput: Object.assign(new CryptoInput(), { id: 4 }),
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    const manager = mockResumeManager(buyCrypto);
    manager.findOne.mockImplementation(async (entityClass: unknown) => (entityClass === BuyCrypto ? buyCrypto : null));

    await service.resume(99);

    expect(buyCrypto.checkoutTx).toBeUndefined();
    expect(buyCrypto.cryptoInput).toBeUndefined();
    expect(manager.update).toHaveBeenCalled();
  });

  it('resume() rejects when a concurrent change invalidates the stopped state', async () => {
    const buyCrypto = Object.assign(new BuyCrypto(), {
      id: 7,
      status: BuyCryptoStatus.STOPPED,
      amlCheck: CheckStatus.PASS,
    });
    const entity = Object.assign(new Transaction(), { id: 99, buyCrypto });
    jest.spyOn(repo, 'findOne').mockResolvedValue(entity);
    mockResumeManager(buyCrypto, { affected: 0, raw: [], generatedMaps: [] });

    await expect(service.resume(99)).rejects.toThrow(ConflictException);
  });
});

describe('TransactionService (create / updateInternal)', () => {
  let service: TransactionService;
  let repo: TransactionRepository;

  beforeEach(async () => {
    ({ service, repo } = await setupService());
  });

  it('assigns a prefixed uid to a new transaction', async () => {
    const entity = new Transaction();
    const dto = { sourceType: TransactionSourceType.BANK_TX, type: TransactionTypeInternal.BUY_CRYPTO };
    jest.spyOn(repo, 'create').mockReturnValue(entity);
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    const result = await service.create(dto);

    expect(repo.create).toHaveBeenCalledWith(dto);
    expect(result).toBe(entity);
    expect(entity.uid).toMatch(/^T[A-Za-z0-9]{16}$/);
  });

  it('derives externalId, mail reset and support issues from an internal update', async () => {
    const ownIssue = Object.assign(new SupportIssue(), { id: 1 });
    const requestIssue = Object.assign(new SupportIssue(), { id: 2 });
    const request = Object.assign(new TransactionRequest(), {
      id: 3,
      externalTransactionId: 'ext-1',
      supportIssues: [requestIssue],
    });
    const entity = Object.assign(new Transaction(), {
      id: 1,
      supportIssues: [ownIssue],
      mailSendDate: new Date(),
    });
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.updateInternal(entity, { request, resetMailSendDate: true });

    expect(entity.externalId).toBe('ext-1');
    expect(entity.mailSendDate).toBeNull();
    expect(entity.supportIssues).toEqual([ownIssue, requestIssue]);
    expect(repo.save).toHaveBeenCalledWith(entity);
  });

  it('clears the externalId of an internal update without a request and keeps the mail send date', async () => {
    const mailSendDate = new Date();
    const entity = Object.assign(new Transaction(), { id: 1, externalId: 'ext-1', mailSendDate });
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.updateInternal(entity, { type: TransactionTypeInternal.BUY_FIAT });

    expect(entity.type).toBe(TransactionTypeInternal.BUY_FIAT);
    expect(entity.externalId).toBeUndefined();
    expect(entity.mailSendDate).toBe(mailSendDate);
  });

  it('takes over the request support issues of a transaction that has none of its own', async () => {
    const requestIssue = Object.assign(new SupportIssue(), { id: 2 });
    const request = Object.assign(new TransactionRequest(), { id: 3, supportIssues: undefined });
    const entity = Object.assign(new Transaction(), { id: 1, supportIssues: undefined });
    jest.spyOn(repo, 'save').mockImplementation(async (e) => e as Transaction);

    await service.updateInternal(entity, { request });
    expect(entity.supportIssues).toEqual([]);

    entity.supportIssues = undefined;
    request.supportIssues = [requestIssue];
    await service.updateInternal(entity, { request });
    expect(entity.supportIssues).toEqual([requestIssue]);
  });

  it('writes through the given entity manager instead of the repository', async () => {
    const entity = Object.assign(new Transaction(), { id: 1 });
    const manager = createMock<EntityManager>();
    jest.spyOn(manager, 'save').mockImplementation(async (_: unknown, e: unknown) => e);

    await service.updateInternal(entity, {}, manager);

    expect(manager.save).toHaveBeenCalledWith(Transaction, entity);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('TransactionService (relation load strategy)', () => {
  let service: TransactionService;
  let repo: TransactionRepository;

  beforeEach(async () => {
    ({ service, repo } = await setupService());
  });

  // The statement path relies on this being forwarded: resolved as a join, its relation tree selects
  // 1664 columns and Postgres rejects the query outright.
  it('forwards the relation load strategy to the repository', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionById(1, { userData: true }, 'query');
    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ relationLoadStrategy: 'query' }));

    await service.getTransactionByUid('T0123456789ABCDEF', { userData: true }, 'query');
    expect(repo.findOne).toHaveBeenLastCalledWith(expect.objectContaining({ relationLoadStrategy: 'query' }));
  });

  it('leaves the strategy undefined when the caller does not ask for one', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionById(1, { userData: true });

    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ relationLoadStrategy: undefined }));
  });

  it('loads no relations when the caller names none', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionById(1);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 }, relations: {}, relationLoadStrategy: undefined });

    await service.getTransactionByUid('T0123456789ABCDEF');
    expect(repo.findOne).toHaveBeenLastCalledWith({
      where: { uid: 'T0123456789ABCDEF' },
      relations: {},
      relationLoadStrategy: undefined,
    });
  });
});

describe('TransactionService (lookups)', () => {
  let service: TransactionService;
  let repo: TransactionRepository;

  beforeEach(async () => {
    ({ service, repo } = await setupService());
  });

  it('skips the query for an empty id list', async () => {
    await expect(service.getTransactionsByIds([])).resolves.toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('looks transactions up by id list', async () => {
    const transactions = [Object.assign(new Transaction(), { id: 1 })];
    jest.spyOn(repo, 'find').mockResolvedValue(transactions);

    await expect(service.getTransactionsByIds([1, 2])).resolves.toBe(transactions);
    expect(repo.find).toHaveBeenCalledWith({ where: { id: In([1, 2]) } });
  });

  it('looks a transaction up by request id', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionByRequestId(5, { user: true });

    expect(repo.findOne).toHaveBeenCalledWith({ where: { request: { id: 5 } }, relations: { user: true } });
  });

  it('looks a transaction up by request uid', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionByRequestUid('R0123456789ABCDEF', { user: true });

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { request: { uid: 'R0123456789ABCDEF' } },
      relations: { user: true },
    });
  });

  it('scopes an external id lookup to the account', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionByExternalId('ext-1', 5, { user: true });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { externalId: 'ext-1', user: { userData: { id: 5 } } },
      relations: { user: true },
    });

    await service.getTransactionByExternalId('ext-1', 5);
    expect(repo.findOne).toHaveBeenLastCalledWith({
      where: { externalId: 'ext-1', user: { userData: { id: 5 } } },
      relations: {},
    });
  });

  it('looks a transaction up by checkout payment id', async () => {
    jest.spyOn(repo, 'findOne').mockResolvedValue(null);

    await service.getTransactionByCkoId('pay_1', { user: true });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { checkoutTx: { paymentId: 'pay_1' } },
      relations: { user: true },
    });

    await service.getTransactionByCkoId('pay_1');
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { checkoutTx: { paymentId: 'pay_1' } }, relations: {} });
  });

  it('finds transactions created before the filter date that still lack a uid', async () => {
    const filterDate = new Date('2024-01-01');
    jest.spyOn(repo, 'findBy').mockResolvedValue([]);

    await service.getTransactionsWithoutUid(filterDate);

    expect(repo.findBy).toHaveBeenCalledWith({ uid: IsNull(), created: LessThanOrEqual(filterDate) });
  });

  it('narrows the account history to the given assets in SQL', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getTransactionsByUserDataId(5, ['BTC', 'ETH']);

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { userData: { id: 5 }, buyCrypto: { inputAsset: In(['BTC', 'ETH']) } },
          { userData: { id: 5 }, buyCrypto: { outputAsset: { name: In(['BTC', 'ETH']) } } },
          { userData: { id: 5 }, buyFiat: { inputAsset: In(['BTC', 'ETH']) } },
          { userData: { id: 5 }, buyFiat: { outputAsset: { name: In(['BTC', 'ETH']) } } },
        ],
        take: 100,
      }),
    );
  });

  it('returns the whole account history when no assets are given', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getTransactionsByUserDataId(5);

    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userData: { id: 5 } } }));
  });

  it('defaults the account period to everything up to now', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getTransactionsForAccount(5);

    const { where, take, skip } = (repo.find as jest.Mock).mock.calls[0][0];
    expect(where.userData).toEqual({ id: 5 });
    expect(where.type).toEqual(Not(IsNull()));
    expect(where.created.value[0]).toEqual(new Date(0));
    expect(take).toBeUndefined();
    expect(skip).toBeUndefined();
  });

  it('applies the account period, limit and offset when given', async () => {
    const from = new Date('2024-01-01');
    const to = new Date('2024-02-01');
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getTransactionsForAccount(5, from, to, 10, 20);

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userData: { id: 5 }, type: Not(IsNull()), created: Between(from, to) },
        take: 10,
        skip: 20,
      }),
    );
  });

  it('queries the user transactions in batches and stops at the limit', async () => {
    const transactions = Array.from({ length: 100 }, (_, i) => Object.assign(new Transaction(), { id: i }));
    jest.spyOn(repo, 'find').mockResolvedValue(transactions);
    const from = new Date('2024-01-01');
    const to = new Date('2024-02-01');

    const result = await service.getTransactionsForUsers(
      Array.from({ length: 250 }, (_, i) => i),
      from,
      to,
      100,
      20,
    );

    expect(result).toHaveLength(100);
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: { id: In(Array.from({ length: 100 }, (_, i) => i)) },
          type: Not(IsNull()),
          created: Between(from, to),
        },
        take: 100,
        skip: 20,
      }),
    );
  });

  it('defaults the user period and leaves the batch size unbounded without a limit', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getTransactionsForUsers([1, 2]);

    const { where, take } = (repo.find as jest.Mock).mock.calls[0][0];
    expect(where.user).toEqual({ id: In([1, 2]) });
    expect(where.created.value[0]).toEqual(new Date(0));
    expect(take).toBeUndefined();
  });

  it('reads all transactions of an account through the given entity manager', async () => {
    const managerRepo = createMock<TransactionRepository>();
    const manager = createMock<EntityManager>();
    jest.spyOn(manager, 'getRepository').mockReturnValue(managerRepo);
    jest.spyOn(managerRepo, 'find').mockResolvedValue([]);

    await service.getAllTransactionsForUserData(5, { user: true }, manager);

    expect(manager.getRepository).toHaveBeenCalledWith(Transaction);
    expect(managerRepo.find).toHaveBeenCalledWith({ where: { userData: { id: 5 } }, relations: { user: true } });
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('falls back to the repository when no entity manager is given', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getAllTransactionsForUserData(5);

    expect(repo.find).toHaveBeenCalledWith({ where: { userData: { id: 5 } }, relations: {} });
  });

  it('records the output date on completion', async () => {
    const outputDate = new Date('2024-01-01');

    await service.completeTransaction(5, outputDate);

    expect(repo.update).toHaveBeenCalledWith(5, { outputDate });
  });

  it('pages the asset transactions with the default window', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getByAssetId(9);

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { type: Not(IsNull()), request: { type: TransactionRequestType.BUY, targetId: 9 } },
          { type: Not(IsNull()), request: { type: TransactionRequestType.SELL, sourceId: 9 } },
        ],
        take: 50,
        skip: 0,
      }),
    );
  });

  it('pages the asset transactions with the given window', async () => {
    jest.spyOn(repo, 'find').mockResolvedValue([]);

    await service.getByAssetId(9, 10, 20);

    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 10, skip: 20 }));
  });
});

describe('TransactionService (query builders)', () => {
  let service: TransactionService;
  let repo: TransactionRepository;

  beforeEach(async () => {
    ({ service, repo } = await setupService());
  });

  describe('getTransactionList', () => {
    it('returns the typed transactions unfiltered when no period is given', async () => {
      const transactions = [Object.assign(new Transaction(), { id: 1 })];
      const { qb } = createQueryBuilderMock({ getMany: transactions });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getTransactionList()).resolves.toBe(transactions);

      expect(qb.where).toHaveBeenCalledWith('transaction.type IS NOT NULL');
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('filters on a closed creation period', async () => {
      const dateFrom = new Date('2024-01-01');
      const dateTo = new Date('2024-02-01');
      const { qb, innerQb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getTransactionList(dateFrom, dateTo);

      expect(innerQb.where).toHaveBeenCalledWith('transaction.created BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      });
      expect(innerQb.andWhere).not.toHaveBeenCalled();
    });

    it('filters on an open creation period', async () => {
      const dateFrom = new Date('2024-01-01');
      const { qb, innerQb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getTransactionList(dateFrom);
      expect(innerQb.where).toHaveBeenCalledWith('transaction.created >= :dateFrom', { dateFrom });

      const dateTo = new Date('2024-02-01');
      await service.getTransactionList(undefined, dateTo);
      expect(innerQb.where).toHaveBeenLastCalledWith('transaction.created <= :dateTo', { dateTo });
    });

    it('adds the output period to a creation period filter', async () => {
      const dateFrom = new Date('2024-01-01');
      const outputFrom = new Date('2024-03-01');
      const outputTo = new Date('2024-04-01');
      const { qb, innerQb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getTransactionList(dateFrom, undefined, outputFrom, outputTo);

      expect(innerQb.andWhere).toHaveBeenCalledWith('transaction.outputDate BETWEEN :outputFrom AND :outputTo', {
        outputFrom,
        outputTo,
      });
    });

    it('filters on the output period alone', async () => {
      const outputFrom = new Date('2024-03-01');
      const { qb, innerQb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getTransactionList(undefined, undefined, outputFrom);
      expect(innerQb.where).toHaveBeenCalledWith('transaction.outputDate >= :outputFrom', {
        outputFrom,
        outputTo: undefined,
      });
      expect(innerQb.andWhere).not.toHaveBeenCalled();

      const outputTo = new Date('2024-04-01');
      await service.getTransactionList(undefined, undefined, undefined, outputTo);
      expect(innerQb.where).toHaveBeenLastCalledWith('transaction.outputDate <= :outputTo', {
        outputFrom: undefined,
        outputTo,
      });
    });
  });

  describe('getManualRefVolume', () => {
    it('sums the manual ref volume and credit of a ref code', async () => {
      const { qb } = createQueryBuilderMock({ getRawOne: { volume: 500, credit: 25 } });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getManualRefVolume('AAA-000')).resolves.toEqual({ volume: 500, credit: 25 });

      expect(qb.where).toHaveBeenCalledWith('transaction.sourceType = :sourceType', {
        sourceType: TransactionSourceType.MANUAL_REF,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('user.ref = :ref', { ref: 'AAA-000' });
    });

    it('reports zero for a ref code without manual transactions', async () => {
      const { qb } = createQueryBuilderMock({ getRawOne: { volume: null, credit: null } });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getManualRefVolume('AAA-000')).resolves.toEqual({ volume: 0, credit: 0 });
    });
  });

  describe('getAuditPeriodVolumes', () => {
    it('groups the period volume by account', async () => {
      const volumes = [{ userDataId: 5, totalVolume: 1000 }];
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-02-01');
      const { qb, innerQb } = createQueryBuilderMock({ getRawMany: volumes });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getAuditPeriodVolumes(startDate, endDate)).resolves.toBe(volumes);

      expect(qb.andWhere).toHaveBeenCalledWith('tx.created BETWEEN :startDate AND :endDate', { startDate, endDate });
      expect(innerQb.where).toHaveBeenCalledWith('buyCrypto.outputDate BETWEEN :startDate AND :endDate');
      expect(innerQb.orWhere).toHaveBeenCalledWith('buyFiat.outputDate BETWEEN :startDate AND :endDate');
      expect(innerQb.orWhere).toHaveBeenCalledWith('refReward.outputDate BETWEEN :startDate AND :endDate');
      expect(qb.groupBy).toHaveBeenCalledWith('tx.userDataId');
    });
  });

  describe('getTransactionByKey', () => {
    it('qualifies an unqualified key with the transaction alias', async () => {
      const transaction = Object.assign(new Transaction(), { id: 1 });
      const { qb } = createQueryBuilderMock({ getOne: transaction });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getTransactionByKey('uid', 'T0123456789ABCDEF')).resolves.toBe(transaction);

      expect(qb.where).toHaveBeenCalledWith('transaction.uid = :param', { param: 'T0123456789ABCDEF' });
    });

    it('keeps a key that already names its alias', async () => {
      const { qb } = createQueryBuilderMock({ getOne: null });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getTransactionByKey('userData.id', 5);

      expect(qb.where).toHaveBeenCalledWith('userData.id = :param', { param: 5 });
    });
  });

  describe('getRefBonusCandidates', () => {
    it("builds the filter condition with the agreement's values", async () => {
      const { qb, innerQb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getRefBonusCandidates('AAA-000', 100);

      expect(innerQb.where).toHaveBeenCalledWith(
        'buyCrypto.usedRef = :usedRef AND buyCrypto.absoluteFeeAmount != 0 AND buyCrypto.status = :completeStatus',
        { usedRef: 'AAA-000', completeStatus: BuyCryptoStatus.COMPLETE },
      );
      expect(innerQb.orWhere).toHaveBeenCalledWith(
        'buyFiat.usedRef = :usedRef AND buyFiat.absoluteFeeAmount != 0 AND buyFiat.isComplete = :isComplete',
        { usedRef: 'AAA-000', isComplete: true },
      );
    });

    it('applies the lower transaction id bound', async () => {
      const { qb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getRefBonusCandidates('AAA-000', 100);

      expect(qb.where).toHaveBeenCalledWith('transaction.id > :minTransactionId', { minTransactionId: 100 });
    });

    it('excludes transactions that already have a ref reward', async () => {
      const { qb } = createQueryBuilderMock({ getMany: [] });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await service.getRefBonusCandidates('AAA-000', 100);

      expect(qb.andWhere).toHaveBeenCalledWith('refReward.id IS NULL');
    });

    it('returns the query result unchanged', async () => {
      const result = [Object.assign(new Transaction(), { id: 201 }), Object.assign(new Transaction(), { id: 202 })];
      const { qb } = createQueryBuilderMock({ getMany: result });
      jest.spyOn(repo, 'createQueryBuilder').mockReturnValue(qb as never);

      await expect(service.getRefBonusCandidates('AAA-000', 100)).resolves.toBe(result);
    });
  });
});
