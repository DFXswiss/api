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
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CryptoInput, PayInAction } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { EntityManager, IsNull } from 'typeorm';
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

describe('TransactionService (relation load strategy)', () => {
  let service: TransactionService;
  let repo: TransactionRepository;

  beforeEach(async () => {
    repo = createMock<TransactionRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionService,
        { provide: TransactionRepository, useValue: repo },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: BankDataService, useValue: createMock<BankDataService>() },
        { provide: SpecialExternalAccountService, useValue: createMock<SpecialExternalAccountService>() },
        { provide: BuyCryptoRepository, useValue: createMock<BuyCryptoRepository>() },
        { provide: TransactionAmlCheckService, useValue: createMock<TransactionAmlCheckService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
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
});
