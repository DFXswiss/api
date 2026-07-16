import { mock } from 'jest-mock-extended';
import { ConfigService } from 'src/config/config';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { In, IsNull, Not } from 'typeorm';
import { createCustomCryptoInput } from '../../entities/__mocks__/crypto-input.entity.mock';
import { PayInAction, PayInStatus } from '../../entities/crypto-input.entity';
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

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    payInRepository = mock<PayInRepository>();
    notificationService = mock<NotificationService>();
    service = new PayInService(
      payInRepository,
      mock<RegisterStrategyRegistry>(),
      mock<SendStrategyRegistry>(),
      mock<TransactionService>(),
      mock<PaymentLinkPaymentService>(),
      mock<PayInBitcoinService>(),
      mock<PayInFiroService>(),
      notificationService,
    );
  });

  it('moves all stranded Sending entries to SendUncertain and sends one monitoring mail listing their IDs', async () => {
    const payIns = [
      createCustomCryptoInput({ id: 41, status: PayInStatus.SENDING }),
      createCustomCryptoInput({ id: 42, status: PayInStatus.SENDING }),
    ];
    jest.spyOn(payInRepository, 'findBy').mockResolvedValue(payIns);
    const saveSpy = jest.spyOn(payInRepository, 'save').mockImplementation(async (payIn) => payIn);
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service['processStrandedSendingPayIns']();

    expect(payInRepository.findBy).toHaveBeenCalledWith({ status: PayInStatus.SENDING });
    expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.SEND_UNCERTAIN, PayInStatus.SEND_UNCERTAIN]);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ errors: [expect.stringContaining('41, 42')] }),
      }),
    );
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
});
