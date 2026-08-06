import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { PimlicoBundlerService } from 'src/integration/blockchain/shared/evm/paymaster/pimlico-bundler.service';
import { PimlicoPaymasterService } from 'src/integration/blockchain/shared/evm/paymaster/pimlico-paymaster.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { olkyEUR } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyFiatService } from '../../process/services/buy-fiat.service';
import { SellRepository } from '../sell.repository';
import { SellService } from '../sell.service';

describe('SellService', () => {
  let service: SellService;

  let sellRepo: SellRepository;
  let userService: UserService;
  let userDataService: UserDataService;
  let depositService: DepositService;
  let assetService: AssetService;
  let payInService: PayInService;
  let buyFiatService: BuyFiatService;
  let transactionUtilService: TransactionUtilService;
  let transactionHelper: TransactionHelper;
  let routeService: RouteService;
  let bankDataService: BankDataService;
  let bankService: jest.Mocked<BankService>;
  let cryptoService: CryptoService;
  let transactionRequestService: TransactionRequestService;
  let blockchainRegistryService: BlockchainRegistryService;
  let pimlicoPaymasterService: PimlicoPaymasterService;
  let pimlicoBundlerService: PimlicoBundlerService;

  beforeEach(async () => {
    sellRepo = createMock<SellRepository>();
    userService = createMock<UserService>();
    userDataService = createMock<UserDataService>();
    depositService = createMock<DepositService>();
    assetService = createMock<AssetService>();
    payInService = createMock<PayInService>();
    buyFiatService = createMock<BuyFiatService>();
    transactionUtilService = createMock<TransactionUtilService>();
    transactionHelper = createMock<TransactionHelper>();
    routeService = createMock<RouteService>();
    bankDataService = createMock<BankDataService>();
    bankService = createMock<BankService>();
    bankService.areKnownBankIbans.mockResolvedValue(false);
    cryptoService = createMock<CryptoService>();
    transactionRequestService = createMock<TransactionRequestService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    pimlicoPaymasterService = createMock<PimlicoPaymasterService>();
    pimlicoBundlerService = createMock<PimlicoBundlerService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellService,
        { provide: SellRepository, useValue: sellRepo },
        { provide: UserService, useValue: userService },
        { provide: UserDataService, useValue: userDataService },
        { provide: DepositService, useValue: depositService },
        { provide: AssetService, useValue: assetService },
        { provide: PayInService, useValue: payInService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: RouteService, useValue: routeService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: BankService, useValue: bankService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: PimlicoPaymasterService, useValue: pimlicoPaymasterService },
        { provide: PimlicoBundlerService, useValue: pimlicoBundlerService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SellService>(SellService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDepositTx', () => {
    const mockRequest = {
      id: 1,
      sourceId: 100,
      amount: 10,
      user: { address: '0x1234567890123456789012345678901234567890' },
    };

    const mockRoute = {
      id: 1,
      deposit: { address: '0x0987654321098765432109876543210987654321' },
    };

    const mockAsset = {
      id: 100,
      blockchain: 'Ethereum',
    };

    const mockUnsignedTx = {
      to: '0x0987654321098765432109876543210987654321',
      data: '0xabcdef',
      value: '0',
      chainId: 1,
    };

    beforeEach(() => {
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(mockAsset as any);
      jest.spyOn(blockchainRegistryService, 'getEvmClient').mockReturnValue({
        prepareTransaction: jest.fn().mockResolvedValue({ ...mockUnsignedTx }),
        chainId: 1,
      } as any);
    });

    it('should NOT include eip5792 when includeEip5792 is false (default)', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(true);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue('https://api.pimlico.io/test');

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeUndefined();
    });

    it('should NOT include eip5792 when includeEip5792 is explicitly false', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(true);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue('https://api.pimlico.io/test');

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, undefined, false);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeUndefined();
    });

    it('should include eip5792 when includeEip5792 is true and paymaster available', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(true);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue('https://api.pimlico.io/test');

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, undefined, true);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeDefined();
      expect(result.eip5792.paymasterUrl).toBe('https://api.pimlico.io/test');
      expect(result.eip5792.chainId).toBe(1);
      expect(result.eip5792.calls).toHaveLength(1);
    });

    it('should NOT include eip5792 when includeEip5792 is true but paymaster not available', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(false);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue(undefined);

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, undefined, true);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeUndefined();
    });
  });

  describe('createSell route persistence', () => {
    // the transaction callback runs against this manager, so a rejected save rolls the route back
    let manager: { save: jest.Mock };

    beforeEach(() => {
      manager = { save: jest.fn().mockResolvedValue({ id: 42 }) };
      jest.spyOn(sellRepo, 'create').mockImplementation((e: any) => ({ ...e }));
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(undefined);
      Object.defineProperty(sellRepo, 'manager', {
        value: { transaction: (cb: any) => cb(manager) },
        configurable: true,
      });
      jest.spyOn(routeService, 'createRoute').mockResolvedValue({ id: 5 } as any);
      jest.spyOn(userDataService, 'getUserDataByUser').mockResolvedValue({ id: 7, isDataComplete: true } as any);
      jest.spyOn(depositService, 'getNextDeposit').mockResolvedValue({ id: 9 } as any);
      jest.spyOn(bankDataService, 'createIbanForUser').mockResolvedValue({ id: 11 } as any);
    });

    it('creates the route inside the same transaction as the sell', async () => {
      await service.createSell(1, { iban: 'DE00', currency: { id: 2 }, blockchain: 'Ethereum' } as any);

      expect(routeService.createRoute).toHaveBeenCalledWith(expect.anything(), manager);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(sellRepo.save).not.toHaveBeenCalled();
    });

    it('does not persist the route outside the transaction when the sell insert is rejected', async () => {
      manager.save.mockRejectedValue(new Error('duplicate key value violates unique constraint'));

      await expect(
        service.createSell(1, { iban: 'DE00', currency: { id: 2 }, blockchain: 'Ethereum' } as any),
      ).rejects.toThrow('duplicate key');

      expect(routeService.createRoute).toHaveBeenCalledTimes(1);
      expect(routeService.createRoute).toHaveBeenCalledWith(expect.anything(), manager);
      expect(sellRepo.save).not.toHaveBeenCalled();
    });
  });

  // CreateSellDto carries @IsDfxIban, but UpdateSellDto is only { active } and never revalidates the
  // stored IBAN. Routes predating that guard therefore stay reactivatable by their owner over
  // PUT /sell/:id (USER role), and buy-fiat then mints a BANK_OUT bankData from sell.iban - a
  // DFX-owned IBAN reaching a customer profile with no admin involved.
  describe('updateSell reactivation', () => {
    const route = (iban: string) => ({ id: 3, iban, active: false, user: { id: 1 } }) as any;

    it('refuses to reactivate a route whose IBAN belongs to DFX', async () => {
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(route(olkyEUR.iban));
      bankService.areKnownBankIbans.mockResolvedValue(true);

      await expect(service.updateSell(1, 3, { active: true })).rejects.toThrow('DFX IBAN not allowed');
      expect(sellRepo.save).not.toHaveBeenCalled();
    });

    it('still allows deactivating such a route', async () => {
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(route(olkyEUR.iban));
      bankService.areKnownBankIbans.mockResolvedValue(true);

      await service.updateSell(1, 3, { active: false });

      expect(sellRepo.save).toHaveBeenCalled();
      // no point asking the bank service when nothing is being switched on
      expect(bankService.areKnownBankIbans).not.toHaveBeenCalled();
    });

    it('reactivates a normal customer route unchanged', async () => {
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(route('DE89370400440532013000'));

      await service.updateSell(1, 3, { active: true });

      expect(sellRepo.save).toHaveBeenCalled();
    });
  });
});
