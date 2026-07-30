import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { BankRepository } from 'src/subdomains/supporting/bank/bank/bank.repository';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VibanAccountHolder } from 'src/subdomains/supporting/bank/virtual-iban/providers/viban-account-holder.enum';
import { VirtualIban, VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanRepository } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.repository';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
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

    it('fails closed before bank or fee selection for an unhandled explicit provider', async () => {
      jest.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, userData, wallet: {} } as any);

      await expect(
        service.toPaymentInfoDto(1, buy, dto({ personalIbanProvider: 'FutureProvider' as PersonalIbanProvider })),
      ).rejects.toThrow(QuoteError.PERSONAL_IBAN_PROVIDER_UNSUPPORTED);

      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
      expect(transactionHelper.getTxDetails).not.toHaveBeenCalled();
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(transactionRequestService.create).not.toHaveBeenCalled();
    });

    it('returns the established payment-method token from the public endpoint for Frick plus CARD', async () => {
      jest.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, userData, wallet: {} } as any);

      await expect(
        service.createBuyPaymentInfo(
          { user: 1, address: '0x123' } as any,
          dto({ paymentMethod: FiatPaymentMethod.CARD }),
        ),
      ).rejects.toThrow(QuoteError.PAYMENT_METHOD_NOT_ALLOWED);

      expect(paymentInfoService.buyCheck).not.toHaveBeenCalled();
      expect(buyRepo.findOne).not.toHaveBeenCalled();
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
    });

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

    it('quotes a different fee when the Frick bank fee differs from the default bank fee', async () => {
      const defaultFees = {
        min: 0,
        rate: 0.01,
        fixed: 0,
        dfx: 1,
        network: 0,
        platform: 0,
        bank: 0,
        total: 1,
      };
      const frickFees = {
        min: 0,
        rate: 0.03,
        fixed: 0,
        dfx: 3,
        network: 0,
        platform: 0,
        bank: 0,
        total: 3,
      };

      jest.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, userData, wallet: {} } as any);
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockResolvedValue(virtualIban);
      jest.spyOn(transactionHelper, 'getTxDetails').mockImplementation(async (...args: unknown[]) => {
        const bankName = args[12];
        const fees = bankName === IbanBankName.FRICK ? frickFees : defaultFees;
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

      // Fee percentage is rate * 100; Frick 3% must surface, not the default 1%.
      expect(response.fee).toBe(3);
      expect(response.fees.rate).toBe(0.03);
      expect(response.fees.total).toBe(3);
      expect(response.fee).not.toBe(1);
      expect(response.fees.rate).not.toBe(0.01);
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
    });

    const incompatibleSelectors: {
      overrides: { currency?: string; paymentMethod?: FiatPaymentMethod };
      message: string;
    }[] = [
      { overrides: { currency: 'CHF' }, message: QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED },
      { overrides: { paymentMethod: FiatPaymentMethod.CARD }, message: QuoteError.PAYMENT_METHOD_NOT_ALLOWED },
    ];

    it.each(incompatibleSelectors)(
      'rejects an incompatible explicit selector without provider fallback %#',
      async ({ overrides, message }) => {
        await expect(
          service['resolveBankInfo'](
            {
              currency: overrides.currency ?? 'EUR',
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
      },
    );

    it('delegates the KYC decision to the locked issuance read and preserves its KycRequired error', async () => {
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockRejectedValue(new Error(QuoteError.KYC_REQUIRED));

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
      ).rejects.toThrow(QuoteError.KYC_REQUIRED);
      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(
        expect.objectContaining({ kycLevel: KycLevel.LEVEL_40 }),
        'EUR',
      );
    });

    it('uses the standard bank for CARD when implicit providers are ineligible for EUR', async () => {
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
        {
          currency: 'EUR',
          paymentMethod: FiatPaymentMethod.CARD,
          userData: { ...userData, kycLevel: KycLevel.LEVEL_40 },
        },
        buy,
        asset,
      );

      expect(resolved).toMatchObject({ bankId: 16, bankName: IbanBankName.OLKY });
      expect(resolved.bankInfo).toMatchObject({ iban: standardBank.iban, isPersonalIban: false });
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
    });

    it('loads invoice data exclusively from persisted IDs and verifies personal-IBAN ownership', async () => {
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(virtualIban);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        19,
        501,
      );

      expect(virtualIbanService.getByIdForUser).toHaveBeenCalledWith(501, userData.id);
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(bankInfo).toMatchObject({ iban: virtualIban.iban, reference: buy.bankUsage });
    });

    it('keeps buy-specific personal IBAN invoices reference-free', async () => {
      const buySpecific = { ...virtualIban, buy } as VirtualIban;
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(buySpecific);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        19,
        501,
      );

      expect(bankInfo).toMatchObject({ iban: virtualIban.iban });
      expect(bankInfo.reference).toBeUndefined();
    });

    it('fails closed when the persisted personal IBAN is not owned by the requesting user', async () => {
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(null);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          true,
          19,
          501,
        ),
      ).rejects.toThrow(QuoteError.STORED_PERSONAL_IBAN_USER_MISMATCH);
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('uses dynamic bank selection only for legacy requests where both persisted IDs are NULL', async () => {
      const legacy = jest.spyOn(service, 'getBankInfo').mockResolvedValue({ iban: 'LEGACY' } as any);

      await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        undefined,
        undefined,
        asset,
        {} as any,
      );

      expect(legacy).toHaveBeenCalled();
    });

    it('rejects an open quote when the stored personal IBAN is inactive', async () => {
      const inactive = { ...virtualIban, active: false } as VirtualIban;
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(inactive);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          true,
          19,
          501,
        ),
      ).rejects.toThrow(QuoteError.STORED_PERSONAL_IBAN_IS_NO_LONGER_ACTIVE);
    });

    it('rejects an open quote when the stored personal IBAN status is not ACTIVE', async () => {
      const deactivated = { ...virtualIban, status: VirtualIbanStatus.DEACTIVATED } as VirtualIban;
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(deactivated);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          true,
          19,
          501,
        ),
      ).rejects.toThrow(QuoteError.STORED_PERSONAL_IBAN_IS_NO_LONGER_ACTIVE);
    });

    it('rejects an open quote immediately when the DB disables a bank despite a stale cached row', async () => {
      const nonReceiveBank = { ...frickBank, receive: false };
      const bankRepo = createMock<BankRepository>();
      jest.spyOn(bankRepo, 'findOneCachedBy').mockResolvedValue(frickBank as any);
      jest.spyOn(bankRepo, 'findOneBy').mockResolvedValue(nonReceiveBank as any);
      const readThroughBankService = new BankService(bankRepo, createMock<VirtualIbanRepository>());
      (service as unknown as { bankService: BankService }).bankService = readThroughBankService;
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(virtualIban);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          true,
          19,
          501,
        ),
      ).rejects.toThrow(QuoteError.STORED_BANK_NO_LONGER_ACCEPTS_PAYMENTS);
      expect(bankRepo.findOneBy).toHaveBeenCalledWith({ id: 19 });
      expect(bankRepo.findOneCachedBy).not.toHaveBeenCalled();
    });

    it('rejects an open quote on the plain-bank path when the bank no longer accepts payments', async () => {
      const nonReceiveBank = { ...frickBank, receive: false };
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(nonReceiveBank as any);

      await expect(
        service.getBankInfoForRequest(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
          buy,
          true,
          19,
          undefined,
        ),
      ).rejects.toThrow(QuoteError.STORED_BANK_NO_LONGER_ACCEPTS_PAYMENTS);
      expect(virtualIbanService.getByIdForUser).not.toHaveBeenCalled();
    });

    it('serves a fully live personal IBAN for an open quote', async () => {
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(virtualIban);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        19,
        501,
      );

      expect(bankInfo).toMatchObject({
        iban: virtualIban.iban,
        isPersonalIban: true,
        reference: buy.bankUsage,
      });
    });

    it('still serves historical data for a completed lookup when the personal IBAN is inactive', async () => {
      const inactive = {
        ...virtualIban,
        active: false,
        status: VirtualIbanStatus.DEACTIVATED,
      } as VirtualIban;
      const nonReceiveBank = { ...frickBank, receive: false };
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(nonReceiveBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(inactive);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        false,
        19,
        501,
      );

      expect(bankInfo).toMatchObject({
        iban: virtualIban.iban,
        isPersonalIban: true,
        reference: buy.bankUsage,
      });
    });

    it('shows DFX name/address as recipient for a Frick personal IBAN (account held by DFX)', async () => {
      jest.spyOn(virtualIbanService, 'getAccountHolder').mockReturnValue(VibanAccountHolder.DFX);
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(frickBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(virtualIban);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        19,
        501,
      );

      expect(virtualIbanService.getAccountHolder).toHaveBeenCalledWith(IbanBankName.FRICK);
      expect(bankInfo).toMatchObject({
        name: Config.bank.dfxAddress.name,
        street: Config.bank.dfxAddress.street,
        number: Config.bank.dfxAddress.number,
        zip: Config.bank.dfxAddress.zip,
        city: Config.bank.dfxAddress.city,
        country: Config.bank.dfxAddress.country,
        iban: virtualIban.iban,
        isPersonalIban: true,
        reference: buy.bankUsage,
      });
      expect(bankInfo.name).not.toBe(userData.completeName);
      expect(bankInfo.street).not.toBe(address.street);
    });

    it('shows the customer name/address as recipient for a Yapeal personal IBAN (account held by customer)', async () => {
      const yapealBank = {
        id: 20,
        name: IbanBankName.YAPEAL,
        iban: 'CH9300762011623852957',
        bic: 'YAPECHZZ',
        receive: true,
        sctInst: false,
      };
      const yapealVirtualIban = {
        id: 502,
        iban: 'CH4400762011623852958',
        bank: yapealBank,
        currency: { id: 1, name: 'CHF' },
        userData,
        active: true,
        status: VirtualIbanStatus.ACTIVE,
        buy: null,
      } as VirtualIban;

      jest.spyOn(virtualIbanService, 'getAccountHolder').mockReturnValue(VibanAccountHolder.CUSTOMER);
      jest.spyOn(bankService, 'getBankByIdUncached').mockResolvedValue(yapealBank as any);
      jest.spyOn(virtualIbanService, 'getByIdForUser').mockResolvedValue(yapealVirtualIban);

      const bankInfo = await service.getBankInfoForRequest(
        { currency: 'CHF', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        true,
        20,
        502,
      );

      expect(virtualIbanService.getAccountHolder).toHaveBeenCalledWith(IbanBankName.YAPEAL);
      expect(bankInfo).toMatchObject({
        name: userData.completeName,
        street: address.street,
        number: address.houseNumber,
        zip: address.zip,
        city: address.city,
        country: address.country.name,
        iban: yapealVirtualIban.iban,
        isPersonalIban: true,
        reference: buy.bankUsage,
      });
      expect(bankInfo.name).not.toBe(Config.bank.dfxAddress.name);
    });
  });

  describe('implicit personal IBAN resolution', () => {
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
    } as UserData;
    const lowKycUserData = { ...userData, kycLevel: KycLevel.LEVEL_40 } as UserData;
    const eur = { id: 2, name: 'EUR', buyable: true } as Fiat;
    const chf = { id: 1, name: 'CHF', buyable: true } as Fiat;
    const buy = { id: 42, active: true, bankUsage: 'ABCD-EFGH-IJKL' } as Buy;
    const frickBank = {
      id: 19,
      name: IbanBankName.FRICK,
      iban: 'LI32088110105923K000C',
      bic: 'BFRILI22XXX',
      receive: true,
      sctInst: true,
    } as Bank;
    const yapealBank = {
      id: 20,
      name: IbanBankName.YAPEAL,
      iban: 'CH9300762011623852957',
      bic: 'YAPECHZZ',
      receive: true,
      sctInst: false,
    } as Bank;
    const collectionBank = {
      id: 16,
      name: IbanBankName.OLKY,
      iban: 'FR7616798060015010806550926',
      bic: 'OLKYFRP1',
      receive: true,
      sctInst: true,
    } as Bank;
    const frickVirtualIban = {
      id: 501,
      iban: 'LI75088110105923K000E',
      bank: frickBank,
      currency: eur,
      userData,
      active: true,
      status: VirtualIbanStatus.ACTIVE,
      buy: null,
    } as VirtualIban;
    const yapealVirtualIban = {
      id: 502,
      iban: 'CH4400762011623852958',
      bank: yapealBank,
      currency: chf,
      userData,
      active: true,
      status: VirtualIbanStatus.ACTIVE,
      buy: null,
    } as VirtualIban;

    it('creates and resolves a personal Frick IBAN for an EUR customer at KYC LEVEL_50', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockResolvedValue(frickVirtualIban);
      jest.spyOn(virtualIbanService, 'getAccountHolder').mockReturnValue(VibanAccountHolder.DFX);

      const bankInfo = await service.getBankInfo(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
      );

      expect(virtualIbanService.getActiveForUserAndCurrency).toHaveBeenCalledWith(userData, 'EUR');
      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(virtualIbanService.createForUser).not.toHaveBeenCalled();
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(bankInfo).toMatchObject({
        bank: IbanBankName.FRICK,
        iban: frickVirtualIban.iban,
        isPersonalIban: true,
      });
      expect(bankInfo.iban).not.toBe(collectionBank.iban);
    });

    it('swallows a transient EUR personal IBAN issuance error before applying the transfer fallback', async () => {
      const transientError = new Error('transient issuance error');
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockRejectedValue(transientError);

      const resolution = service.getBankInfo(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
      );

      await expect(resolution).rejects.not.toBe(transientError);
      await expect(resolution).rejects.toBeInstanceOf(BadRequestException);
      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(virtualIbanService.isUserEligible).toHaveBeenCalledTimes(2);
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('reports PersonalIbanIssuanceFailed for an eligible EUR transfer after issuance fails', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest
        .spyOn(virtualIbanService, 'getOrCreateFrickForUser')
        .mockRejectedValue(new Error('transient issuance error'));

      await expect(
        service.getBankInfo({ currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData }, buy),
      ).rejects.toThrow(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('reports KycRequired for an ineligible EUR transfer without a personal IBAN', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(false);

      await expect(
        service.getBankInfo(
          { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData: lowKycUserData },
          buy,
        ),
      ).rejects.toThrow(QuoteError.KYC_REQUIRED);

      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
      expect(bankService.getBank).not.toHaveBeenCalled();
    });

    it('continues to the standard bank for CARD after a transient EUR personal IBAN issuance error', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest
        .spyOn(virtualIbanService, 'getOrCreateFrickForUser')
        .mockRejectedValue(new Error('transient issuance error'));
      jest.spyOn(bankService, 'getBank').mockResolvedValue(collectionBank);

      const bankInfo = await service.getBankInfo(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.CARD, userData },
        buy,
      );

      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(bankService.getBank).toHaveBeenCalledWith({
        currency: 'EUR',
        paymentMethod: FiatPaymentMethod.CARD,
        userData,
      });
      expect(bankInfo).toMatchObject({
        bank: IbanBankName.OLKY,
        iban: collectionBank.iban,
        isPersonalIban: false,
      });
    });

    it.each([FiatPaymentMethod.BANK, FiatPaymentMethod.INSTANT])(
      'rejects EUR %s with KycRequired below KYC LEVEL_50 instead of returning the collection IBAN',
      async (paymentMethod) => {
        jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
        jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(false);
        jest.spyOn(bankService, 'getBank').mockResolvedValue(collectionBank);

        const resolution = service.getBankInfo(
          { currency: 'EUR', paymentMethod, userData: lowKycUserData },
          buy,
        );

        await expect(resolution).rejects.toBeInstanceOf(BadRequestException);
        await expect(resolution).rejects.toThrow(QuoteError.KYC_REQUIRED);
        expect(virtualIbanService.createForUser).not.toHaveBeenCalled();
        expect(bankService.getBank).not.toHaveBeenCalled();
      },
    );

    it('continues to the standard bank for CARD below KYC LEVEL_50', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(false);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(collectionBank);

      const bankInfo = await service.getBankInfo(
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.CARD, userData: lowKycUserData },
        buy,
      );

      expect(bankService.getBank).toHaveBeenCalledWith({
        currency: 'EUR',
        paymentMethod: FiatPaymentMethod.CARD,
        userData: lowKycUserData,
      });
      expect(bankInfo).toMatchObject({
        bank: IbanBankName.OLKY,
        iban: collectionBank.iban,
        isPersonalIban: false,
      });
    });

    it('keeps resolving CHF to a Yapeal personal IBAN at KYC LEVEL_50', async () => {
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest.spyOn(virtualIbanService, 'createForUser').mockResolvedValue(yapealVirtualIban);
      jest.spyOn(virtualIbanService, 'getAccountHolder').mockReturnValue(VibanAccountHolder.CUSTOMER);

      const bankInfo = await service.getBankInfo(
        { currency: 'CHF', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
      );

      expect(virtualIbanService.createForUser).toHaveBeenCalledWith(userData, 'CHF');
      expect(bankService.getBank).not.toHaveBeenCalled();
      expect(bankInfo).toMatchObject({
        bank: IbanBankName.YAPEAL,
        iban: yapealVirtualIban.iban,
        isPersonalIban: true,
      });
      expect(bankInfo.bank).not.toBe(IbanBankName.FRICK);
    });
  });

  describe('bankInOverride scope (Frick selector only)', () => {
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
      personalIbanEnabled: true,
    } as Asset;
    const wallet = { id: 3, buySpecificIbanEnabled: true } as any;
    const buy = { id: 42, active: true, bankUsage: 'ABCD-EFGH-IJKL', asset } as Buy;
    const buySpecificBank = {
      id: 22,
      name: IbanBankName.MAERKI,
      iban: 'CH9300762011623852957',
      bic: 'MAEBCHZZXXX',
      receive: true,
      sctInst: false,
    };
    const buySpecificVirtualIban = {
      id: 777,
      iban: 'CH4431999123000889012',
      bank: buySpecificBank,
      currency,
      userData,
      active: true,
      status: VirtualIbanStatus.ACTIVE,
      buy,
    } as VirtualIban;
    const defaultRouteBank = {
      id: 16,
      name: IbanBankName.OLKY,
      iban: 'FR7616798060015010806550926',
      bic: 'OLKYFRP1',
      receive: true,
      sctInst: true,
    } as any;

    function feeResult() {
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
    }

    it('skips buy-specific personal IBAN issuance for EUR and resolves through the user-level Frick path', async () => {
      const userLevelVirtualIban = {
        ...buySpecificVirtualIban,
        id: 778,
        bank: { ...buySpecificBank, name: IbanBankName.FRICK },
        buy: null,
      } as VirtualIban;
      jest.spyOn(virtualIbanService, 'getActiveForBuyAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(true);
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser').mockResolvedValue(userLevelVirtualIban);

      const resolved = await service['resolveBankInfo'](
        { currency: 'EUR', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        asset,
        wallet,
      );

      expect(virtualIbanService.getActiveForBuyAndCurrency).not.toHaveBeenCalled();
      expect(virtualIbanService.createForBuy).not.toHaveBeenCalled();
      expect(virtualIbanService.getOrCreateFrickForUser).toHaveBeenCalledWith(userData, 'EUR');
      expect(resolved).toMatchObject({
        bankId: userLevelVirtualIban.bank.id,
        virtualIbanId: userLevelVirtualIban.id,
        bankName: IbanBankName.FRICK,
      });
    });

    it('creates a buy-specific personal IBAN for CHF when the asset and wallet flags are enabled', async () => {
      const chfVirtualIban = {
        ...buySpecificVirtualIban,
        currency: { ...currency, id: 1, name: 'CHF' },
      } as VirtualIban;
      jest.spyOn(virtualIbanService, 'getActiveForBuyAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'countActiveForUser').mockResolvedValue(9);
      jest.spyOn(virtualIbanService, 'createForBuy').mockResolvedValue(chfVirtualIban);

      const resolved = await service['resolveBankInfo'](
        { currency: 'CHF', paymentMethod: FiatPaymentMethod.BANK, userData },
        buy,
        asset,
        wallet,
      );

      expect(virtualIbanService.getActiveForBuyAndCurrency).toHaveBeenCalledWith(buy.id, 'CHF');
      expect(virtualIbanService.countActiveForUser).toHaveBeenCalledWith(userData.id);
      expect(virtualIbanService.createForBuy).toHaveBeenCalledWith(userData, buy, 'CHF');
      expect(virtualIbanService.getActiveForUserAndCurrency).not.toHaveBeenCalled();
      expect(resolved).toMatchObject({
        bankId: chfVirtualIban.bank.id,
        virtualIbanId: chfVirtualIban.id,
        bankName: chfVirtualIban.bank.name,
      });
    });

    it('does not pass bankInOverride for a buy-bound personal-IBAN customer (no selector)', async () => {
      jest.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, userData, wallet } as any);
      jest.spyOn(virtualIbanService, 'getActiveForBuyAndCurrency').mockResolvedValue(buySpecificVirtualIban);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(defaultRouteBank);
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue(feeResult());

      const dto = {
        amount: 100,
        currency,
        asset,
        paymentMethod: FiatPaymentMethod.BANK,
        exactPrice: false,
        // no personalIbanProvider — legacy buy-bound path
      } as GetBuyPaymentInfoDto;

      const response = await service.toPaymentInfoDto(1, buy, dto);

      // Deposit destination still comes from the buy-bound vIBAN (response correctness).
      expect(response.iban).toBe(buySpecificVirtualIban.iban);
      expect(response.bank).toBe(IbanBankName.MAERKI);
      expect(virtualIbanService.getActiveForBuyAndCurrency).toHaveBeenCalledWith(buy.id, 'EUR');
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
      // Fee calc must fall through to getBankIn() — not the buy-bound bank name.
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
        undefined,
      );
      expect(transactionRequestService.create).toHaveBeenCalledWith(
        TransactionRequestType.BUY,
        dto,
        response,
        1,
        undefined,
      );
    });

    it('does not pass bankInOverride for a CARD customer without a personal IBAN', async () => {
      const plainAsset = { ...asset, personalIbanEnabled: false } as Asset;
      const plainBuy = { ...buy, asset: plainAsset } as Buy;
      const cardUserData = { ...userData, kycLevel: KycLevel.LEVEL_40 };

      jest.spyOn(userService, 'getUser').mockResolvedValue({
        id: 1,
        userData: cardUserData,
        wallet: { id: 3, buySpecificIbanEnabled: false },
      } as any);
      jest.spyOn(virtualIbanService, 'getActiveForBuyAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency').mockResolvedValue(null);
      jest.spyOn(virtualIbanService, 'isUserEligible').mockReturnValue(false);
      jest.spyOn(bankService, 'getBank').mockResolvedValue(defaultRouteBank);
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue(feeResult());

      const dto = {
        amount: 100,
        currency,
        asset: plainAsset,
        paymentMethod: FiatPaymentMethod.CARD,
        exactPrice: false,
      } as GetBuyPaymentInfoDto;

      const response = await service.toPaymentInfoDto(1, plainBuy, dto);

      expect(response.iban).toBe(defaultRouteBank.iban);
      expect(response.bank).toBe(IbanBankName.OLKY);
      expect(response.isPersonalIban).toBe(false);
      expect(transactionHelper.getTxDetails).toHaveBeenCalledWith(
        100,
        undefined,
        currency,
        plainAsset,
        FiatPaymentMethod.CARD,
        expect.anything(),
        false,
        expect.anything(),
        undefined,
        [],
        undefined,
        undefined,
        undefined,
      );
      expect(transactionRequestService.create).toHaveBeenCalledWith(
        TransactionRequestType.BUY,
        dto,
        response,
        1,
        undefined,
      );
    });

    it('does not create external accounts when getTxDetails fails (no personalIbanProvider)', async () => {
      // Merge-base order: fees/limits first, bank resolution (incl. createForUser) only afterwards.
      // A failed quote must never leave an unretractable external account for non-selector customers.
      const plainAsset = { ...asset, personalIbanEnabled: false } as Asset;
      const plainBuy = { ...buy, asset: plainAsset } as Buy;

      jest.spyOn(userService, 'getUser').mockResolvedValue({
        id: 1,
        userData,
        wallet: { id: 3, buySpecificIbanEnabled: false },
      } as any);
      jest.spyOn(transactionHelper, 'getTxDetails').mockRejectedValue(new Error('fee calc failed'));
      jest.spyOn(virtualIbanService, 'createForUser');
      jest.spyOn(virtualIbanService, 'createForBuy');
      jest.spyOn(virtualIbanService, 'getActiveForUserAndCurrency');
      jest.spyOn(virtualIbanService, 'getActiveForBuyAndCurrency');
      jest.spyOn(virtualIbanService, 'getOrCreateFrickForUser');
      jest.spyOn(virtualIbanService, 'isUserEligible');
      jest.spyOn(bankService, 'getBank');

      const dto = {
        amount: 100,
        currency,
        asset: plainAsset,
        paymentMethod: FiatPaymentMethod.BANK,
        exactPrice: false,
        // no personalIbanProvider
      } as GetBuyPaymentInfoDto;

      await expect(service.toPaymentInfoDto(1, plainBuy, dto)).rejects.toThrow('fee calc failed');

      expect(virtualIbanService.createForUser).not.toHaveBeenCalled();
      expect(virtualIbanService.createForBuy).not.toHaveBeenCalled();
      expect(virtualIbanService.getActiveForUserAndCurrency).not.toHaveBeenCalled();
      expect(virtualIbanService.getActiveForBuyAndCurrency).not.toHaveBeenCalled();
      expect(virtualIbanService.getOrCreateFrickForUser).not.toHaveBeenCalled();
      expect(virtualIbanService.isUserEligible).not.toHaveBeenCalled();
      expect(bankService.getBank).not.toHaveBeenCalled();
    });
  });
});
