import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomCryptoRoute } from 'src/subdomains/core/buy-crypto/routes/swap/__mocks__/crypto-route.entity.mock';
import { SwapRepository } from 'src/subdomains/core/buy-crypto/routes/swap/swap.repository';
import { createCustomDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoRegistrationService } from '../buy-crypto-registration.service';
import { BuyCryptoService } from '../buy-crypto.service';

/**
 * The route scan runs on every buy-crypto cron tick and used to read the whole swap table as full
 * entities. These tests pin the two properties that made it cheap: the candidate scan is projected
 * and skips the eager relations, and only the routes that actually matched are read back in full.
 */
describe('BuyCryptoRegistrationService', () => {
  let service: BuyCryptoRegistrationService;
  let swapRepo: jest.Mocked<SwapRepository>;
  let payInService: jest.Mocked<PayInService>;
  let buyCryptoRepo: jest.Mocked<BuyCryptoRepository>;
  let buyCryptoService: jest.Mocked<BuyCryptoService>;
  let transactionHelper: jest.Mocked<TransactionHelper>;

  const deposit = (address: string, blockchains = `${Blockchain.BITCOIN}`) =>
    createCustomDeposit({ id: 1, address, blockchains });

  // isPayment is a getter over txType, so the non-payment branch is selected via txType.
  const payIn = (address: string, blockchain = Blockchain.BITCOIN) =>
    createCustomCryptoInput({ id: 10, address: { address, blockchain } as never, txType: PayInType.DEPOSIT });

  beforeEach(() => {
    swapRepo = createMock<SwapRepository>();
    payInService = createMock<PayInService>();
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    buyCryptoService = createMock<BuyCryptoService>();
    transactionHelper = createMock<TransactionHelper>();

    buyCryptoRepo.existsBy.mockResolvedValue(false);
    transactionHelper.validateInput.mockResolvedValue(true);

    service = new BuyCryptoRegistrationService(
      buyCryptoRepo,
      buyCryptoService,
      swapRepo,
      payInService,
      transactionHelper,
    );
  });

  it('projects the candidate scan and drops the eager relations', async () => {
    payInService.getNewPayIns.mockResolvedValue([payIn('addr-1')]);
    swapRepo.find.mockResolvedValue([]);

    await service.registerCryptoPayIn();

    expect(swapRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, deposit: { id: true, address: true, blockchains: true } },
        loadEagerRelations: false,
      }),
    );
  });

  it('does not read routes back when nothing matched', async () => {
    payInService.getNewPayIns.mockResolvedValue([payIn('no-such-address')]);
    swapRepo.find.mockResolvedValue([createCustomCryptoRoute({ id: 1, deposit: deposit('addr-1') })]);

    await service.registerCryptoPayIn();

    expect(swapRepo.find).toHaveBeenCalledTimes(1);
    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
  });

  it('reads only the matched routes back in full, with the user relations', async () => {
    const matched = createCustomCryptoRoute({ id: 7, deposit: deposit('addr-7') });
    payInService.getNewPayIns.mockResolvedValue([payIn('addr-7')]);
    swapRepo.find
      .mockResolvedValueOnce([createCustomCryptoRoute({ id: 1, deposit: deposit('addr-1') }), matched])
      .mockResolvedValueOnce([matched]);

    await service.registerCryptoPayIn();

    expect(swapRepo.find).toHaveBeenCalledTimes(2);
    expect(swapRepo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        relations: { deposit: true, user: { userData: true, wallet: true } },
      }),
    );
    expect(buyCryptoService.createFromCryptoInput).toHaveBeenCalledTimes(1);
  });

  it('matches the deposit address case-insensitively', async () => {
    const matched = createCustomCryptoRoute({ id: 7, deposit: deposit('AbCdEf') });
    payInService.getNewPayIns.mockResolvedValue([payIn('abcdef')]);
    swapRepo.find.mockResolvedValueOnce([matched]).mockResolvedValueOnce([matched]);

    await service.registerCryptoPayIn();

    expect(buyCryptoService.createFromCryptoInput).toHaveBeenCalledTimes(1);
  });

  it('skips a pay-in whose route disappeared between the two reads', async () => {
    const matched = createCustomCryptoRoute({ id: 7, deposit: deposit('addr-7') });
    payInService.getNewPayIns.mockResolvedValue([payIn('addr-7')]);
    swapRepo.find.mockResolvedValueOnce([matched]).mockResolvedValueOnce([]);

    await service.registerCryptoPayIn();

    expect(buyCryptoService.createFromCryptoInput).not.toHaveBeenCalled();
    expect(payInService.acknowledgePayIn).not.toHaveBeenCalled();
  });
});
