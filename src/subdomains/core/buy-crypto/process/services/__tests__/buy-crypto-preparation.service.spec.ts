import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoStatus } from '../../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoPreparationService } from '../buy-crypto-preparation.service';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';
import { BuyCryptoService } from '../buy-crypto.service';

describe('BuyCryptoPreparationService', () => {
  let service: BuyCryptoPreparationService;

  let buyCryptoRepo: BuyCryptoRepository;
  let transactionHelper: TransactionHelper;
  let pricingService: PricingService;
  let fiatService: FiatService;
  let buyCryptoService: BuyCryptoService;
  let amlService: AmlService;
  let siftService: SiftService;
  let countryService: CountryService;
  let bankService: BankService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let virtualIbanService: VirtualIbanService;
  let transactionService: TransactionService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    transactionHelper = createMock<TransactionHelper>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    amlService = createMock<AmlService>();
    siftService = createMock<SiftService>();
    countryService = createMock<CountryService>();
    bankService = createMock<BankService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    buyCryptoNotificationService = createMock<BuyCryptoNotificationService>();
    virtualIbanService = createMock<VirtualIbanService>();
    transactionService = createMock<TransactionService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoPreparationService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PricingService, useValue: pricingService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: AmlService, useValue: amlService },
        { provide: SiftService, useValue: siftService },
        { provide: CountryService, useValue: countryService },
        { provide: BankService, useValue: bankService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: TransactionService, useValue: transactionService },
      ],
    }).compile();

    service = module.get<BuyCryptoPreparationService>(BuyCryptoPreparationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chargebackFillUp', () => {
    it('should complete an order whose chargebackOutput is complete and take the chargebackBankTx from it', async () => {
      const chargebackBankTx = { id: 42 } as any;

      const entity = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null, // mirrors production shape of a refunded chargeback (no crypto output)
        chargebackOutput: { isComplete: true, bankTx: chargebackBankTx } as any,
      });

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);

      await service.chargebackFillUp();

      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(1);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity.id, {
        chargebackBankTx,
        isComplete: true,
        status: BuyCryptoStatus.COMPLETE,
      });
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledTimes(1);
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledWith(entity);
    });

    it('should query with the chargebackOutput-complete filter and load the bankTx relation', async () => {
      const findSpy = jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([]);

      await service.chargebackFillUp();

      // assert the filter selects only refunded-and-settled orders, incl. operator direction
      const where = findSpy.mock.calls[0][0].where as any;
      expect(where.amlCheck).toBe(CheckStatus.FAIL);
      expect(where.isComplete).toBe(false);
      expect(where.chargebackBankTx.type).toBe('isNull'); // IsNull(): not yet linked
      expect(where.chargebackOutput.isComplete).toBe(true);
      expect(where.chargebackOutput.bankTx.id.type).toBe('not'); // Not(...): outer operator
      expect(where.chargebackOutput.bankTx.id.child.type).toBe('isNull'); // Not(IsNull()): refund already settled

      // the fix reads entity.chargebackOutput.bankTx, so that relation must be loaded
      const relations = findSpy.mock.calls[0][0].relations as any;
      expect(relations.chargebackOutput.bankTx).toBe(true);

      // empty result set → nothing is completed
      expect(buyCryptoRepo.update).not.toHaveBeenCalled();
      expect(buyCryptoWebhookService.triggerWebhook).not.toHaveBeenCalled();
    });

    it('should continue completing remaining orders even if a webhook fails for one of them', async () => {
      const entity1 = createCustomBuyCrypto({
        id: 1,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null,
        chargebackOutput: { isComplete: true, bankTx: { id: 42 } } as any,
      });

      const entity2 = createCustomBuyCrypto({
        id: 2,
        amlCheck: CheckStatus.FAIL,
        isComplete: false,
        outputAmount: null,
        chargebackOutput: { isComplete: true, bankTx: { id: 43 } } as any,
      });

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity1, entity2]);
      jest
        .spyOn(buyCryptoWebhookService, 'triggerWebhook')
        .mockRejectedValueOnce(new Error('webhook down'))
        .mockResolvedValue(undefined);

      await service.chargebackFillUp();

      expect(buyCryptoRepo.update).toHaveBeenCalledTimes(2);
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity1.id, expect.objectContaining({ isComplete: true }));
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(entity2.id, expect.objectContaining({ isComplete: true }));
      expect(buyCryptoWebhookService.triggerWebhook).toHaveBeenCalledTimes(2);
    });
  });

  describe('doAmlCheck — concurrent decision guard', () => {
    function arrangeAmlCheck(entity: ReturnType<typeof createCustomBuyCrypto>) {
      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue([entity]);
      jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue({} as any);
      jest.spyOn(transactionHelper, 'getMinVolume').mockResolvedValue(0);
      jest.spyOn(transactionHelper, 'getVolumeChfSince').mockResolvedValue(0);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: () => 100 } as any);
      jest.spyOn(countryService, 'getCountryWithSymbol').mockResolvedValue(undefined);
      jest.spyOn(amlService, 'getAmlCheckInput').mockResolvedValue({
        users: [{} as any],
        refUser: undefined,
        recommender: undefined,
        bankData: undefined,
        blacklist: [],
        phoneCallList: [],
        banks: [],
        ipLogCountries: [],
        multiAccountBankNames: [],
      } as any);
      // bypass the heavy getAmlResult/getAmlErrors internals; we only test the persistence guard
      jest.spyOn(entity, 'amlCheckAndFillUp').mockReturnValue([entity.id, { amlCheck: CheckStatus.PASS }] as any);
    }

    it('skips post-processing (no overwrite) when the conditional update affects 0 rows', async () => {
      // first-run tx (amlCheck=null) that a reviewer concurrently changed → cron write must not win
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 0 } as any);

      await service.doAmlCheck();

      // guarded write: criteria is an object carrying the amlCheck guard, not a bare id
      expect(buyCryptoRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
      );
      expect(amlService.postProcessing).not.toHaveBeenCalled();
    });

    it('runs post-processing when the conditional update affects the row', async () => {
      const entity = createCustomBuyCrypto({ id: 1, amlCheck: null, cryptoInput: undefined, bankTx: undefined });
      arrangeAmlCheck(entity);
      jest.spyOn(buyCryptoRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
    });
  });
});
