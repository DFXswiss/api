import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { IsNull } from 'typeorm';
import { createCustomBuyFiat } from '../../__mocks__/buy-fiat.entity.mock';
import { BuyFiatRepository } from '../../buy-fiat.repository';
import { BuyFiatNotificationService } from '../buy-fiat-notification.service';
import { BuyFiatPreparationService } from '../buy-fiat-preparation.service';
import { BuyFiatService } from '../buy-fiat.service';

describe('BuyFiatPreparationService', () => {
  let service: BuyFiatPreparationService;

  let buyFiatRepo: BuyFiatRepository;
  let transactionHelper: TransactionHelper;
  let pricingService: PricingService;
  let feeService: FeeService;
  let buyFiatService: BuyFiatService;
  let amlService: AmlService;
  let countryService: CountryService;
  let buyFiatNotificationService: BuyFiatNotificationService;
  let fiatOutputService: FiatOutputService;
  let transactionService: TransactionService;
  let custodyOrderService: CustodyOrderService;
  let scorechainScreeningService: ScorechainScreeningService;

  beforeEach(async () => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    transactionHelper = createMock<TransactionHelper>();
    pricingService = createMock<PricingService>();
    feeService = createMock<FeeService>();
    buyFiatService = createMock<BuyFiatService>();
    amlService = createMock<AmlService>();
    countryService = createMock<CountryService>();
    buyFiatNotificationService = createMock<BuyFiatNotificationService>();
    fiatOutputService = createMock<FiatOutputService>();
    transactionService = createMock<TransactionService>();
    custodyOrderService = createMock<CustodyOrderService>();
    scorechainScreeningService = createMock<ScorechainScreeningService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyFiatPreparationService,
        { provide: BuyFiatRepository, useValue: buyFiatRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PricingService, useValue: pricingService },
        { provide: FeeService, useValue: feeService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: AmlService, useValue: amlService },
        { provide: CountryService, useValue: countryService },
        { provide: BuyFiatNotificationService, useValue: buyFiatNotificationService },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: TransactionService, useValue: transactionService },
        { provide: CustodyOrderService, useValue: custodyOrderService },
        { provide: ScorechainScreeningService, useValue: scorechainScreeningService },
      ],
    }).compile();

    service = module.get<BuyFiatPreparationService>(BuyFiatPreparationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function arrangeAmlCheck(entity: ReturnType<typeof createCustomBuyFiat>) {
    entity.cryptoInput.isConfirmed = true;
    jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([entity]);
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
    } as any);
    // bypass the heavy getAmlResult/getAmlErrors internals; we only test the persistence guard
    jest.spyOn(entity, 'amlCheckAndFillUp').mockReturnValue([entity.id, { amlCheck: CheckStatus.PASS }] as any);
  }

  describe('doAmlCheck — concurrent decision guard', () => {
    it('skips post-processing (no overwrite) when the conditional update affects 0 rows', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: null });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 0 } as any);

      await service.doAmlCheck();

      // guarded write: criteria carries the amlCheck guard (NULL first-run), not a bare id
      expect(buyFiatRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, amlCheck: IsNull() }),
        expect.objectContaining({ amlCheck: CheckStatus.PASS }),
      );
      expect(amlService.postProcessing).not.toHaveBeenCalled();
    });

    it('runs post-processing when the conditional update affects the row', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: null });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
    });
  });

  describe('doAmlCheck — post-processing retry guard', () => {
    it('re-selects a PASS whose post-processing did not complete (retry branch)', async () => {
      const findSpy = jest.spyOn(buyFiatRepo, 'find').mockResolvedValue([]);

      await service.doAmlCheck();

      const where = findSpy.mock.calls[0][0].where as any[];
      expect(where).toEqual(
        expect.arrayContaining([expect.objectContaining({ amlCheck: CheckStatus.PASS, amlPostProcessed: false })]),
      );
    });

    it('marks amlPostProcessed=true once a PASS has been post-processed', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: CheckStatus.PASS, amlPostProcessed: false });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);

      await service.doAmlCheck();

      expect(amlService.postProcessing).toHaveBeenCalledTimes(1);
      expect(buyFiatRepo.update).toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });

    it('leaves amlPostProcessed unset when post-processing throws, so the next run retries', async () => {
      const entity = createCustomBuyFiat({ id: 1, amlCheck: CheckStatus.PASS, amlPostProcessed: false });
      arrangeAmlCheck(entity);
      jest.spyOn(buyFiatRepo, 'update').mockResolvedValue({ affected: 1 } as any);
      jest.spyOn(amlService, 'postProcessing').mockRejectedValue(new Error('transient db failure'));

      await service.doAmlCheck();

      expect(buyFiatRepo.update).not.toHaveBeenCalledWith(1, { amlPostProcessed: true });
    });
  });
});
