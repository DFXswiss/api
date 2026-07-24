import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VirtualIban, VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyRepository } from '../buy.repository';
import { BuyService } from '../buy.service';
import { Buy } from '../buy.entity';
import { GetBuyPaymentInfoDto, PersonalIbanProvider } from '../dto/get-buy-payment-info.dto';

describe('BuyService', () => {
  let service: BuyService;

  let buyRepo: BuyRepository;
  let userService: UserService;
  let routeService: RouteService;
  let transactionHelper: TransactionHelper;
  let swissQrService: SwissQRService;
  let paymentInfoService: PaymentInfoService;
  let bankService: BankService;
  let transactionRequestService: TransactionRequestService;
  let checkoutService: CheckoutService;
  let virtualIbanService: VirtualIbanService;

  beforeEach(async () => {
    buyRepo = createMock<BuyRepository>();
    userService = createMock<UserService>();
    routeService = createMock<RouteService>();
    paymentInfoService = createMock<PaymentInfoService>();
    swissQrService = createMock<SwissQRService>();
    bankService = createMock<BankService>();
    transactionRequestService = createMock<TransactionRequestService>();
    transactionHelper = createMock<TransactionHelper>();
    checkoutService = createMock<CheckoutService>();
    virtualIbanService = createMock<VirtualIbanService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyService,
        { provide: BuyRepository, useValue: buyRepo },
        { provide: UserService, useValue: userService },
        { provide: RouteService, useValue: routeService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: SwissQRService, useValue: swissQrService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: BankService, useValue: bankService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: CheckoutService, useValue: checkoutService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BuyService>(BuyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('explicit Bank Frick personal IBAN', () => {
    const address = {
      street: 'Teststrasse',
      houseNumber: '7',
      zip: '8000',
      city: 'Zurich',
      country: { name: 'CH' },
    };
    const userData = {
      id: 7,
      kycLevel: KycLevel.LEVEL_50,
      completeName: 'Test User',
      address,
      language: { symbol: 'DE' },
    } as any;
    const currency = { id: 2, name: 'EUR', buyable: true } as Fiat;
    const asset = {
      id: 10,
      name: 'BTC',
      uniqueName: 'Bitcoin/BTC',
      dexName: 'BTC',
      decimals: 8,
      buyable: true,
      blockchain: 'Bitcoin',
    } as Asset;
    const buy = { id: 42, active: true, bankUsage: 'ABCD-EFGH-IJKL', asset } as Buy;
    const frickBank = {
      id: 19,
      name: IbanBankName.FRICK,
      iban: 'LI32088110105923K000C',
      bic: 'BFRILI22XXX',
      receive: true,
      sctInst: false,
    };
    const virtualIban = {
      id: 501,
      iban: 'LI75088110105923K000E',
      bank: frickBank,
      currency,
      userData,
      active: true,
      status: VirtualIbanStatus.ACTIVE,
      buy: null,
    } as VirtualIban;

    function dto(overrides: Partial<GetBuyPaymentInfoDto> = {}): GetBuyPaymentInfoDto {
      return {
        amount: 100,
        currency,
        asset,
        paymentMethod: FiatPaymentMethod.BANK,
        exactPrice: false,
        personalIbanProvider: PersonalIbanProvider.FRICK,
        ...overrides,
      } as GetBuyPaymentInfoDto;
    }

    it('selects Frick once before fee calculation, persists exact IDs, and does not leak IDs publicly', async () => {
      const events: string[] = [];
      jest.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, userData, wallet: {} } as any);
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockImplementation(async () => {
        events.push('bank');
        return virtualIban;
      });
      jest.spyOn(transactionHelper, 'getTxDetails').mockImplementation(async () => {
        events.push('fees');
        const fees = {
          min: 0,
          rate: 0.01,
          fixed: 0,
          dfx: 1,
          network: 0,
          platform: 0,
          bank: 0,
          total: 1,
        };
        return {
          timestamp: new Date('2026-07-24T00:00:00Z'),
          minVolume: 10,
          minVolumeTarget: 0.001,
          maxVolume: 10000,
          maxVolumeTarget: 1,
          exchangeRate: 100000,
          rate: 101000,
          estimatedAmount: 0.00099,
          sourceAmount: 100,
          isValid: false,
          exactPrice: false,
          feeSource: fees,
          feeTarget: fees,
          priceSteps: [],
        } as any;
      });

      const response = await service.toPaymentInfoDto(1, buy, dto());

      expect(events).toEqual(['bank', 'fees']);
      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(transactionHelper.getTxDetails).toHaveBeenCalledWith(
        100,
        undefined,
        currency,
        asset,
        FiatPaymentMethod.BANK,
        expect.anything(),
        false,
        expect.anything(),
        undefined,
        [],
        undefined,
        undefined,
        IbanBankName.FRICK,
      );
      expect(transactionRequestService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ personalIbanProvider: PersonalIbanProvider.FRICK }),
        response,
        1,
        { bankId: 19, virtualIbanId: 501 },
      );
      expect(response).toMatchObject({
        iban: virtualIban.iban,
        bank: IbanBankName.FRICK,
        isPersonalIban: true,
        remittanceInfo: buy.bankUsage,
      });
      expect(response).not.toHaveProperty('bankId');
      expect(response).not.toHaveProperty('virtualIbanId');
    });

    it.each([
      [{ currency: { ...currency, name: 'CHF' } }, 'only available for EUR'],
      [{ paymentMethod: FiatPaymentMethod.CARD }, 'requires bank payment'],
    ])('rejects an incompatible explicit selector without provider fallback %#', async (overrides, message) => {
      await expect(
        service['resolveBankInfo'](
          {
            currency: (overrides.currency as Fiat | undefined)?.name ?? 'EUR',
            paymentMethod: overrides.paymentMethod ?? FiatPaymentMethod.BANK,
            userData,
          },
          buy,
          asset,
          undefined,
          PersonalIbanProvider.FRICK,
        ),
      ).rejects.toThrow(message);

      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('rejects KYC below 50 with the established KycRequired error', async () => {
      await expect(
        service['resolveBankInfo'](
          {
            currency: 'EUR',
            paymentMethod: FiatPaymentMethod.BANK,
            userData: { ...userData, kycLevel: KycLevel.LEVEL_40 },
          },
          buy,
          asset,
          undefined,
          PersonalIbanProvider.FRICK,
        ),
      ).rejects.toThrow('KycRequired');
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
    });

    it('uses the standard bank without the selector when implicit providers are ineligible for EUR', async () => {
      const standardBank = {
        id: 16,
        name: IbanBankName.OLKY,
        iban: 'FR7616798060015010806550926',
        bic: 'OLKYFRP1',
        receive: true,
        sctInst: true,
      } as any;
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(false);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(standardBank);

      const resolved = await service['resolveBankInfo'](
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        asset,
      );

      expect(resolved).toMatchObject({ bankId: 16, bankName: IbanBankName.OLKY });
      expect(resolved.bankInfo).toMatchObject({ iban: standardBank.iban, isPersonalIban: false });
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
    });

    it('loads invoice data exclusively from persisted IDs and verifies personal-IBAN ownership', async () => {
      jest.spyOn(bankService, 'getBankById').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(virtualIban);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        19,
        501,
      );

      expect(virtualIbanService.getByIdForUser).toHaveBeenCalledWith(501, userData.id);
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(bankInfo).toMatchObject({ iban: virtualIban.iban, reference: buy.bankUsage });
    });

    it('keeps buy-specific personal IBAN invoices reference-free', async () => {
      const buySpecific = { ...virtualIban, buy } as VirtualIban;
      jest.spyOn(bankService, 'getBankById').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(buySpecific);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        19,
        501,
      );

      expect(bankInfo).toMatchObject({ iban: virtualIban.iban });
      expect(bankInfo.reference).toBeUndefined();
    });

    it('fails closed when the persisted personal IBAN is not owned by the requesting user', async () => {
      jest.spyOn(bankService, 'getBankById').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(null);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          19,
          501,
        ),
      ).rejects.toThrow('does not belong to this user');
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('uses dynamic bank selection only for legacy requests where both persisted IDs are NULL', async () => {
      const legacy = jest.spyOn(service, 'getBankInfo').mockResolvedValue({ iban: 'LEGACY' } as any);

      await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        undefined,
        undefined,
        asset,
        {} as any,
      );

      expect(legacy).toHaveBeenCalled();
    });
  });
});
