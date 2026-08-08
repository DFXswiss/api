import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { TransactionTypeInternal } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { EntityManager, In, IsNull, LessThan, Not } from 'typeorm';
import { RetryPayInSendDto } from '../../dto/retry-payin-send.dto';
import { createCustomCryptoInput } from '../../entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInAction, PayInStatus, PayInType } from '../../entities/crypto-input.entity';
import { PayInEntry } from '../../interfaces';
import { PayInRepository } from '../../repositories/payin.repository';
import { RegisterStrategyRegistry } from '../../strategies/register/impl/base/register.strategy-registry';
import { SendStrategyRegistry } from '../../strategies/send/impl/base/send.strategy-registry';
import { PayInBitcoinService } from '../payin-bitcoin.service';
import { PayInFiroService } from '../payin-firo.service';
import { PayInService } from '../payin.service';

describe('PayInService designate-before-broadcast safeguards', () => {
  let service: PayInService;
  let payInRepository: PayInRepository;
  let notificationService: NotificationService;
  let transactionService: TransactionService;

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    payInRepository = mock<PayInRepository>();
    notificationService = mock<NotificationService>();
    transactionService = mock<TransactionService>();
    service = new PayInService(
      payInRepository,
      mock<RegisterStrategyRegistry>(),
      mock<SendStrategyRegistry>(),
      transactionService,
      mock<PaymentLinkPaymentService>(),
      mock<PayInBitcoinService>(),
      mock<PayInFiroService>(),
      notificationService,
    );
  });

  it('conditionally escalates old Sending entries and mails only the IDs whose transition won', async () => {
    const cutoff = new Date('2026-07-16T10:00:00.000Z');
    const payIns = [
      createCustomCryptoInput({ id: 41, status: PayInStatus.SENDING }),
      createCustomCryptoInput({ id: 42, status: PayInStatus.SENDING }),
      createCustomCryptoInput({ id: 43, status: PayInStatus.SENDING }),
    ];
    const minutesBeforeSpy = jest.spyOn(Util, 'minutesBefore').mockReturnValueOnce(cutoff);
    jest.spyOn(payInRepository, 'find').mockResolvedValue(payIns);
    const updateSpy = jest
      .spyOn(payInRepository, 'update')
      .mockResolvedValueOnce({ affected: 1 } as any)
      .mockResolvedValueOnce({ affected: 0 } as any)
      .mockRejectedValueOnce(new Error('deadlock'));
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service['processStrandedSendingPayIns']();

    expect(minutesBeforeSpy).toHaveBeenCalledWith(10);
    expect(payInRepository.find).toHaveBeenCalledWith({
      where: { status: PayInStatus.SENDING, updated: LessThan(cutoff) },
      select: { id: true },
      loadEagerRelations: false,
    });
    expect(updateSpy).toHaveBeenNthCalledWith(
      1,
      { id: 41, status: PayInStatus.SENDING },
      { status: PayInStatus.SEND_UNCERTAIN },
    );
    expect(updateSpy).toHaveBeenNthCalledWith(
      2,
      { id: 42, status: PayInStatus.SENDING },
      { status: PayInStatus.SEND_UNCERTAIN },
    );
    expect(updateSpy).toHaveBeenNthCalledWith(
      3,
      { id: 43, status: PayInStatus.SENDING },
      { status: PayInStatus.SEND_UNCERTAIN },
    );
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          errors: ['Pay-ins left in Sending require manual investigation: 41'],
          isLiqMail: true,
        }),
        correlationId: '|41|',
        options: { suppressRecurring: true },
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('41'));
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('does not send mail when no Sending entries are old enough to be stranded', async () => {
    jest.spyOn(payInRepository, 'find').mockResolvedValue([]);
    const updateSpy = jest.spyOn(payInRepository, 'update');
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail');

    await service['processStrandedSendingPayIns']();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  describe('#updatePayInAction(...)', () => {
    const exclusionWhere = {
      id: 77,
      action: Not(PayInAction.RETURN),
      status: Not(In([PayInStatus.TO_RETURN, PayInStatus.RETURNED, PayInStatus.RETURN_CONFIRMED])),
      returnTxId: IsNull(),
    };

    it.each([
      [CheckStatus.PASS, PayInAction.FORWARD],
      [CheckStatus.FAIL, PayInAction.WAITING],
    ])('updates action with return-exclusion where for amlCheck %s → %s', async (amlCheck, expectedAction) => {
      const updateSpy = jest.spyOn(payInRepository, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.updatePayInAction(77, amlCheck);

      expect(updateSpy).toHaveBeenCalledWith(exclusionWhere, { action: expectedAction });
    });

    it.each([CheckStatus.PENDING, CheckStatus.GSHEET, CheckStatus.UNNECESSARY])(
      'returns early without update for non-PASS/FAIL amlCheck %s',
      async (amlCheck) => {
        const updateSpy = jest.spyOn(payInRepository, 'update');

        await service.updatePayInAction(77, amlCheck);

        expect(updateSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe('#returnPayIn(...)', () => {
    const returnAddress = '0x0000000000000000000000000000000000000001';
    const chargebackAmount = 0.1;

    function idlePayIn(overrides: Partial<CryptoInput> = {}): CryptoInput {
      return createCustomCryptoInput({
        id: 52,
        status: PayInStatus.ACKNOWLEDGED,
        action: PayInAction.WAITING,
        returnTxId: null,
        transaction: { id: 53 } as CryptoInput['transaction'],
        route: { user: { id: 54 } } as CryptoInput['route'],
        ...overrides,
      });
    }

    /** Own-transaction path: claim + updateInternal must share the tx manager. */
    function mockOwnTransaction(fresh: CryptoInput | null, updateAffected = 1) {
      const txRepo = {
        findOne: jest.fn().mockResolvedValue(fresh),
        update: jest.fn().mockResolvedValue({ affected: updateAffected }),
      };
      const txManager = {
        getRepository: jest.fn().mockReturnValue(txRepo),
      } as unknown as EntityManager;
      const transactionSpy = jest.fn(async (run: (m: EntityManager) => unknown) => run(txManager));
      Object.defineProperty(payInRepository, 'manager', {
        configurable: true,
        value: { transaction: transactionSpy },
      });
      return { txRepo, txManager, transactionSpy };
    }

    it('without a manager, runs claim and updateInternal inside one repository transaction', async () => {
      const fresh = idlePayIn();
      const { txRepo, txManager, transactionSpy } = mockOwnTransaction(fresh);
      const updateInternalSpy = jest.spyOn(transactionService, 'updateInternal').mockResolvedValue(undefined as never);
      const repoFindSpy = jest.spyOn(payInRepository, 'findOne');
      const repoUpdateSpy = jest.spyOn(payInRepository, 'update');

      await service.returnPayIn(idlePayIn({ status: PayInStatus.ACKNOWLEDGED }), returnAddress, chargebackAmount);

      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(txManager.getRepository).toHaveBeenCalledWith(CryptoInput);
      expect(txRepo.findOne).toHaveBeenCalledWith({
        where: { id: 52 },
        relations: { route: { user: true }, transaction: true },
      });
      expect(txRepo.update).toHaveBeenCalledWith(
        {
          id: 52,
          status: PayInStatus.ACKNOWLEDGED,
          action: PayInAction.WAITING,
          returnTxId: IsNull(),
        },
        {
          status: PayInStatus.TO_RETURN,
          action: PayInAction.RETURN,
          destinationAddress: BlockchainAddress.create(returnAddress, Blockchain.ETHEREUM),
          chargebackAmount,
        },
      );
      expect(updateInternalSpy).toHaveBeenCalledWith(
        fresh.transaction,
        { type: TransactionTypeInternal.CRYPTO_INPUT_RETURN, user: fresh.route.user },
        txManager,
      );
      expect(txRepo.update.mock.invocationCallOrder[0]).toBeLessThan(updateInternalSpy.mock.invocationCallOrder[0]);
      expect(repoFindSpy).not.toHaveBeenCalled();
      expect(repoUpdateSpy).not.toHaveBeenCalled();
      expect(payInRepository.save).not.toHaveBeenCalled();
    });

    it('guards evaluate the fresh row, not the caller snapshot', async () => {
      const staleCaller = idlePayIn({ status: PayInStatus.ACKNOWLEDGED });
      const freshReturned = idlePayIn({ status: PayInStatus.RETURNED });
      const { txRepo, transactionSpy } = mockOwnTransaction(freshReturned);

      await expect(service.returnPayIn(staleCaller, returnAddress, chargebackAmount)).rejects.toThrow(
        new BadRequestException('CryptoInput return already scheduled or executed'),
      );
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('guards when the fresh row already has returnTxId set', async () => {
      const staleCaller = idlePayIn({ status: PayInStatus.ACKNOWLEDGED, returnTxId: null });
      const freshWithTx = idlePayIn({ status: PayInStatus.ACKNOWLEDGED, returnTxId: '0xabc' });
      const { txRepo } = mockOwnTransaction(freshWithTx);

      await expect(service.returnPayIn(staleCaller, returnAddress, chargebackAmount)).rejects.toThrow(
        new BadRequestException('CryptoInput return already scheduled or executed'),
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('rejects re-triggering an already-scheduled TO_RETURN row', async () => {
      const staleCaller = idlePayIn({ status: PayInStatus.ACKNOWLEDGED });
      const freshToReturn = idlePayIn({
        status: PayInStatus.TO_RETURN,
        action: PayInAction.RETURN,
        returnTxId: null,
      });
      const { txRepo } = mockOwnTransaction(freshToReturn);

      await expect(service.returnPayIn(staleCaller, returnAddress, chargebackAmount)).rejects.toThrow(
        new BadRequestException('CryptoInput return already scheduled or executed'),
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('rejects re-triggering when action is RETURN even in PREPARING', async () => {
      const staleCaller = idlePayIn({ status: PayInStatus.ACKNOWLEDGED });
      const freshPreparingReturn = idlePayIn({
        status: PayInStatus.PREPARING,
        action: PayInAction.RETURN,
        returnTxId: null,
      });
      const { txRepo } = mockOwnTransaction(freshPreparingReturn);

      await expect(service.returnPayIn(staleCaller, returnAddress, chargebackAmount)).rejects.toThrow(
        new BadRequestException('CryptoInput return already scheduled or executed'),
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it.each([PayInStatus.SENDING, PayInStatus.SEND_UNCERTAIN])(
      'rejects when the fresh send status is %s',
      async (status) => {
        const staleCaller = idlePayIn({ status: PayInStatus.ACKNOWLEDGED });
        const freshInFlight = idlePayIn({ status, action: PayInAction.WAITING, returnTxId: null });
        const { txRepo } = mockOwnTransaction(freshInFlight);

        await expect(service.returnPayIn(staleCaller, returnAddress, chargebackAmount)).rejects.toThrow(
          new BadRequestException('CryptoInput send in flight or uncertain'),
        );
        expect(txRepo.update).not.toHaveBeenCalled();
        expect(payInRepository.save).not.toHaveBeenCalled();
      },
    );

    it('throws ConflictException when the claim loses and does not relabel the transaction', async () => {
      const fresh = idlePayIn();
      const { txRepo } = mockOwnTransaction(fresh, 0);
      const updateInternalSpy = jest.spyOn(transactionService, 'updateInternal');

      await expect(service.returnPayIn(fresh, returnAddress, chargebackAmount)).rejects.toThrow(
        new ConflictException('CryptoInput state changed concurrently'),
      );
      expect(txRepo.update).toHaveBeenCalled();
      expect(updateInternalSpy).not.toHaveBeenCalled();
    });

    it('calls transactionService.updateInternal after a winning claim (via own transaction)', async () => {
      const fresh = idlePayIn();
      const { txRepo, txManager } = mockOwnTransaction(fresh);
      const updateInternalSpy = jest.spyOn(transactionService, 'updateInternal').mockResolvedValue(undefined as never);

      await service.returnPayIn(fresh, returnAddress, chargebackAmount);

      expect(updateInternalSpy).toHaveBeenCalledWith(
        fresh.transaction,
        { type: TransactionTypeInternal.CRYPTO_INPUT_RETURN, user: fresh.route.user },
        txManager,
      );
      expect(txRepo.update.mock.invocationCallOrder[0]).toBeLessThan(updateInternalSpy.mock.invocationCallOrder[0]);
    });

    it('with a caller-provided manager, does not open its own transaction', async () => {
      const fresh = idlePayIn();
      const repo = {
        findOne: jest.fn().mockResolvedValue(fresh),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(repo),
      } as unknown as EntityManager;
      jest.spyOn(transactionService, 'updateInternal').mockResolvedValue(undefined as never);
      const transactionSpy = jest.fn();
      Object.defineProperty(payInRepository, 'manager', {
        configurable: true,
        value: { transaction: transactionSpy },
      });
      const repoFindSpy = jest.spyOn(payInRepository, 'findOne');
      const repoUpdateSpy = jest.spyOn(payInRepository, 'update');

      await service.returnPayIn(fresh, returnAddress, chargebackAmount, manager);

      expect(transactionSpy).not.toHaveBeenCalled();
      expect(manager.getRepository).toHaveBeenCalledWith(CryptoInput);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 52 },
        relations: { route: { user: true }, transaction: true },
      });
      expect(repo.update).toHaveBeenCalledWith(
        {
          id: 52,
          status: PayInStatus.ACKNOWLEDGED,
          action: PayInAction.WAITING,
          returnTxId: IsNull(),
        },
        expect.objectContaining({
          status: PayInStatus.TO_RETURN,
          action: PayInAction.RETURN,
          chargebackAmount,
        }),
      );
      expect(transactionService.updateInternal).toHaveBeenCalledWith(
        fresh.transaction,
        { type: TransactionTypeInternal.CRYPTO_INPUT_RETURN, user: fresh.route.user },
        manager,
      );
      expect(repoFindSpy).not.toHaveBeenCalled();
      expect(repoUpdateSpy).not.toHaveBeenCalled();
      expect(payInRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the fresh row is missing', async () => {
      const { txRepo } = mockOwnTransaction(null);

      await expect(service.returnPayIn(idlePayIn(), returnAddress, chargebackAmount)).rejects.toThrow(
        new NotFoundException('CryptoInput not found'),
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });
  });

  it('keeps Sending and SendUncertain in the finance-log pending set', async () => {
    const findBySpy = jest.spyOn(payInRepository, 'findBy').mockResolvedValue([]);

    await service.getPendingPayIns();

    expect(findBySpy).toHaveBeenCalledWith({
      status: In([
        PayInStatus.ACKNOWLEDGED,
        PayInStatus.FORWARDED,
        PayInStatus.RETURNED,
        PayInStatus.TO_RETURN,
        PayInStatus.SENDING,
        PayInStatus.SEND_UNCERTAIN,
      ]),
      isConfirmed: true,
      txType: Not(PayInType.PAYMENT),
    });
  });

  it('keeps the forward query restricted to Acknowledged, Preparing and Prepared', async () => {
    const findSpy = jest.spyOn(payInRepository, 'find').mockResolvedValue([]);

    await service['forwardPayIns']();

    expect(findSpy).toHaveBeenCalledWith({
      where: {
        status: In([PayInStatus.ACKNOWLEDGED, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.FORWARD,
        outTxId: IsNull(),
        asset: Not(IsNull()),
        isConfirmed: true,
      },
      relations: { buyCrypto: true, buyFiat: true },
    });
  });

  it('keeps the return query restricted to ToReturn, Preparing and Prepared', async () => {
    const findSpy = jest.spyOn(payInRepository, 'find').mockResolvedValue([]);

    await service['returnPayIns']();

    expect(findSpy).toHaveBeenCalledWith({
      where: {
        status: In([PayInStatus.TO_RETURN, PayInStatus.PREPARING, PayInStatus.PREPARED]),
        action: PayInAction.RETURN,
        returnTxId: IsNull(),
        asset: Not(IsNull()),
        chargebackAmount: Not(IsNull()),
        isConfirmed: true,
      },
      relations: { buyCrypto: true, buyFiat: true },
    });
  });

  describe('#createPayIns(...)', () => {
    function buildEntry(overrides: Partial<PayInEntry> = {}): PayInEntry {
      return {
        senderAddresses: '0xSENDER',
        receiverAddress: BlockchainAddress.create('0xDEPOSIT', Blockchain.ETHEREUM),
        txId: 'TX_UNPRICED',
        txType: PayInType.DEPOSIT,
        txSequence: undefined,
        blockHeight: 100,
        amount: 5,
        asset: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.spyOn(payInRepository, 'exists').mockResolvedValue(false);
      jest.spyOn(payInRepository, 'save').mockImplementation(async (payIn) => payIn as any);
      jest.spyOn(service['transactionService'], 'create').mockResolvedValue({} as any);
    });

    it('alerts monitoring when a newly created pay-in has no processable asset', async () => {
      const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      const [payIn] = await service.createPayIns([buildEntry({ asset: null })]);

      expect(payIn.status).toBe(PayInStatus.FAILED);
      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      expect(sendMailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            subject: 'Pay-in without processable asset',
            isLiqMail: true,
          }),
          correlationId: '|TX_UNPRICED|',
          options: { suppressRecurring: true },
        }),
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('TX_UNPRICED'));
    });

    it('does not alert when the pay-in registers normally with a processable asset', async () => {
      const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

      const asset = { id: 7 } as Asset;
      const [payIn] = await service.createPayIns([buildEntry({ asset, txId: 'TX_PRICED' })]);

      expect(payIn.status).not.toBe(PayInStatus.FAILED);
      expect(sendMailSpy).not.toHaveBeenCalled();
    });

    it('does not alert on a FAILED pay-in whose asset is present but amount is zero', async () => {
      const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

      const asset = { id: 7 } as Asset;
      const [payIn] = await service.createPayIns([buildEntry({ asset, amount: 0, txId: 'TX_ZERO_AMOUNT' })]);

      expect(payIn.status).toBe(PayInStatus.FAILED);
      expect(sendMailSpy).not.toHaveBeenCalled();
    });

    it('does not let a monitoring mail failure interrupt pay-in registration', async () => {
      jest.spyOn(notificationService, 'sendMail').mockRejectedValue(new Error('smtp down'));
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      const result = await service.createPayIns([buildEntry({ asset: null })]);

      expect(result).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send pay-in-without-asset alert'),
        new Error('smtp down'),
      );
    });
  });

  describe('#retryUncertainSend(...)', () => {
    const accountId = 42;
    const baseDto: RetryPayInSendDto = {
      id: 1,
      noBroadcastVerified: true,
      verificationReference: 'explorer: no tx; ticket SUP-123',
    };

    it('throws NotFoundException when the pay-in does not exist', async () => {
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(null);
      const updateSpy = jest.spyOn(payInRepository, 'update');

      await expect(service.retryUncertainSend(accountId, baseDto)).rejects.toThrow(NotFoundException);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the status is not SendUncertain', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SENDING,
        action: PayInAction.FORWARD,
        outTxId: null,
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update');

      await expect(service.retryUncertainSend(accountId, baseDto)).rejects.toThrow(BadRequestException);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when outTxId is set (must be reconciled, not retried)', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.FORWARD,
        outTxId: 'OUT_TX_ALREADY_SET',
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update');

      await expect(service.retryUncertainSend(accountId, baseDto)).rejects.toThrow(BadRequestException);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when returnTxId is set (must be reconciled, not retried)', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.RETURN,
        outTxId: null,
        returnTxId: 'RETURN_TX_ALREADY_SET',
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update');

      await expect(service.retryUncertainSend(accountId, baseDto)).rejects.toThrow(BadRequestException);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when noBroadcastVerified is not true and never updates', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.FORWARD,
        outTxId: null,
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update');

      await expect(service.retryUncertainSend(accountId, { ...baseDto, noBroadcastVerified: false })).rejects.toThrow(
        BadRequestException,
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('resets a FORWARD pay-in to Acknowledged with a conditional update on SendUncertain', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.FORWARD,
        outTxId: null,
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update').mockResolvedValue({ affected: 1 } as any);
      const infoSpy = jest.spyOn(service['logger'], 'info').mockImplementation();

      await service.retryUncertainSend(accountId, baseDto);

      expect(updateSpy).toHaveBeenCalledWith(
        { id: payIn.id, status: PayInStatus.SEND_UNCERTAIN },
        { status: PayInStatus.ACKNOWLEDGED },
      );
      expect(infoSpy).toHaveBeenCalled();
    });

    it('resets a RETURN pay-in to ToReturn with a conditional update on SendUncertain', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.RETURN,
        outTxId: null,
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      const updateSpy = jest.spyOn(payInRepository, 'update').mockResolvedValue({ affected: 1 } as any);
      jest.spyOn(service['logger'], 'info').mockImplementation();

      await service.retryUncertainSend(accountId, baseDto);

      expect(updateSpy).toHaveBeenCalledWith(
        { id: payIn.id, status: PayInStatus.SEND_UNCERTAIN },
        { status: PayInStatus.TO_RETURN },
      );
    });

    it('throws ConflictException when the conditional update affects no rows (concurrent state change)', async () => {
      const payIn = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.FORWARD,
        outTxId: null,
        returnTxId: null,
      });
      jest.spyOn(payInRepository, 'findOneBy').mockResolvedValue(payIn);
      jest.spyOn(payInRepository, 'update').mockResolvedValue({ affected: 0 } as any);

      await expect(service.retryUncertainSend(accountId, baseDto)).rejects.toThrow(ConflictException);
    });
  });
});
