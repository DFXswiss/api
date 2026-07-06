import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { IsNull } from 'typeorm';
import { SwapRepository } from '../../../routes/swap/swap.repository';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoRegistrationService } from '../buy-crypto-registration.service';
import { BuyCryptoService } from '../buy-crypto.service';

describe('BuyCryptoRegistrationService.syncReturnTxId', () => {
  let service: BuyCryptoRegistrationService;
  let buyCryptoRepo: DeepMocked<BuyCryptoRepository>;

  beforeEach(() => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    service = new BuyCryptoRegistrationService(
      buyCryptoRepo,
      createMock<BuyCryptoService>(),
      createMock<SwapRepository>(),
      createMock<PayInService>(),
      createMock<TransactionHelper>(),
    );
  });

  it('reports the real returned amount when the pay-in has a return amount', async () => {
    const entity: any = {
      id: 1,
      chargebackAmount: 100,
      cryptoInput: { returnTxId: 'RETURN_TX', returnAmount: 97.5 },
    };
    buyCryptoRepo.find.mockResolvedValue([entity]);

    await service.syncReturnTxId();

    expect(buyCryptoRepo.update).toHaveBeenCalledWith(1, {
      chargebackCryptoTxId: 'RETURN_TX',
      chargebackAmount: 97.5,
      isComplete: true,
    });
  });

  it('falls back to the authorized amount when no return amount is set', async () => {
    const entity: any = {
      id: 2,
      chargebackAmount: 100,
      cryptoInput: { returnTxId: 'RETURN_TX', returnAmount: null },
    };
    buyCryptoRepo.find.mockResolvedValue([entity]);

    await service.syncReturnTxId();

    expect(buyCryptoRepo.update).toHaveBeenCalledWith(2, {
      chargebackCryptoTxId: 'RETURN_TX',
      chargebackAmount: 100,
      isComplete: true,
    });
  });

  it('keeps the idempotency guard (only unprocessed entities)', async () => {
    buyCryptoRepo.find.mockResolvedValue([]);

    await service.syncReturnTxId();

    const where = buyCryptoRepo.find.mock.calls[0][0].where as any;
    expect(where.chargebackCryptoTxId).toEqual(IsNull());
    expect(buyCryptoRepo.update).not.toHaveBeenCalled();
  });
});
