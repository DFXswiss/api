import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { IsNull } from 'typeorm';
import { SellRepository } from '../../../route/sell.repository';
import { BuyFiatRepository } from '../../buy-fiat.repository';
import { BuyFiatRegistrationService } from '../buy-fiat-registration.service';
import { BuyFiatService } from '../buy-fiat.service';

describe('BuyFiatRegistrationService.syncReturnTxId', () => {
  let service: BuyFiatRegistrationService;
  let buyFiatRepo: DeepMocked<BuyFiatRepository>;
  let buyFiatService: DeepMocked<BuyFiatService>;
  let payoutService: DeepMocked<PayoutService>;

  beforeEach(() => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    buyFiatService = createMock<BuyFiatService>();
    payoutService = createMock<PayoutService>();

    service = new BuyFiatRegistrationService(
      buyFiatRepo,
      buyFiatService,
      createMock<SellRepository>(),
      createMock<PayInService>(),
      createMock<TransactionHelper>(),
      payoutService,
    );
  });

  it('reports the real returned amount and keeps the webhook consistent with the DB', async () => {
    const entity: any = {
      id: 1,
      chargebackAmount: 100,
      cryptoInput: { status: PayInStatus.RETURN_CONFIRMED, returnTxId: 'RETURN_TX', returnAmount: 97.5 },
    };
    buyFiatRepo.find.mockResolvedValue([entity]);

    await service.syncReturnTxId();

    expect(buyFiatRepo.update).toHaveBeenCalledWith(1, {
      chargebackTxId: 'RETURN_TX',
      chargebackAmount: 97.5,
      isComplete: true,
    });
    // in-memory value set before the webhook -> webhook payload matches the DB value
    expect(entity.chargebackAmount).toBe(97.5);
    expect(buyFiatService.triggerWebhook).toHaveBeenCalledWith(expect.objectContaining({ chargebackAmount: 97.5 }));
  });

  it('falls back to the authorized amount for payout returns without a return amount', async () => {
    const entity: any = {
      id: 2,
      chargebackAmount: 100,
      cryptoInput: { status: PayInStatus.FORWARD_CONFIRMED, returnTxId: null, returnAmount: null },
    };
    buyFiatRepo.find.mockResolvedValue([entity]);
    payoutService.checkOrderCompletion.mockResolvedValue({ isComplete: true, payoutTxId: 'PAYOUT_TX' } as any);

    await service.syncReturnTxId();

    expect(buyFiatRepo.update).toHaveBeenCalledWith(2, {
      chargebackTxId: 'PAYOUT_TX',
      chargebackAmount: 100,
      isComplete: true,
    });
    expect(entity.chargebackAmount).toBe(100);
  });

  it('keeps the idempotency guard (only entities without a chargeback tx)', async () => {
    buyFiatRepo.find.mockResolvedValue([]);

    await service.syncReturnTxId();

    const where = buyFiatRepo.find.mock.calls[0][0].where as any[];
    expect(where[0].chargebackTxId).toEqual(IsNull());
    expect(where[1].chargebackTxId).toEqual(IsNull());
    expect(buyFiatRepo.update).not.toHaveBeenCalled();
  });
});
