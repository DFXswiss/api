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
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyCryptoWebhookService } from '../../../process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from '../../../process/services/buy-crypto.service';
import { SwapRepository } from '../swap.repository';
import { SwapService } from '../swap.service';

describe('SwapService', () => {
  let service: SwapService;

  let swapRepo: SwapRepository;
  let userService: UserService;
  let userDataService: UserDataService;
  let depositService: DepositService;
  let assetService: AssetService;
  let payInService: PayInService;
  let buyCryptoService: BuyCryptoService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let transactionUtilService: TransactionUtilService;
  let routeService: RouteService;
  let transactionHelper: TransactionHelper;
  let cryptoService: CryptoService;
  let transactionRequestService: TransactionRequestService;
  let blockchainRegistryService: BlockchainRegistryService;
  let pimlicoPaymasterService: PimlicoPaymasterService;
  let pimlicoBundlerService: PimlicoBundlerService;

  beforeEach(async () => {
    swapRepo = createMock<SwapRepository>();
    userService = createMock<UserService>();
    userDataService = createMock<UserDataService>();
    depositService = createMock<DepositService>();
    assetService = createMock<AssetService>();
    payInService = createMock<PayInService>();
    buyCryptoService = createMock<BuyCryptoService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    transactionUtilService = createMock<TransactionUtilService>();
    routeService = createMock<RouteService>();
    transactionHelper = createMock<TransactionHelper>();
    cryptoService = createMock<CryptoService>();
    transactionRequestService = createMock<TransactionRequestService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    pimlicoPaymasterService = createMock<PimlicoPaymasterService>();
    pimlicoBundlerService = createMock<PimlicoBundlerService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SwapService,
        { provide: SwapRepository, useValue: swapRepo },
        { provide: UserService, useValue: userService },
        { provide: UserDataService, useValue: userDataService },
        { provide: DepositService, useValue: depositService },
        { provide: AssetService, useValue: assetService },
        { provide: PayInService, useValue: payInService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: RouteService, useValue: routeService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CryptoService, useValue: cryptoService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: PimlicoPaymasterService, useValue: pimlicoPaymasterService },
        { provide: PimlicoBundlerService, useValue: pimlicoBundlerService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SwapService>(SwapService);
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

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, false);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeUndefined();
    });

    it('should include eip5792 when includeEip5792 is true and paymaster available', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(true);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue('https://api.pimlico.io/test');

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, true);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeDefined();
      expect(result.eip5792.paymasterUrl).toBe('https://api.pimlico.io/test');
      expect(result.eip5792.chainId).toBe(1);
      expect(result.eip5792.calls).toHaveLength(1);
    });

    it('should NOT include eip5792 when includeEip5792 is true but paymaster not available', async () => {
      jest.spyOn(pimlicoPaymasterService, 'isPaymasterAvailable').mockReturnValue(false);
      jest.spyOn(pimlicoPaymasterService, 'getBundlerUrl').mockReturnValue(undefined);

      const result = await service.createDepositTx(mockRequest as any, mockRoute as any, true);

      expect(result).toBeDefined();
      expect(result.eip5792).toBeUndefined();
    });
  });
});
