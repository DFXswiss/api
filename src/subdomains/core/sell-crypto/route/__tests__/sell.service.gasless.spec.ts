import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702RelayerService } from 'src/integration/blockchain/shared/evm/eip7702/eip7702-relayer.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { BuyFiatService } from '../../process/services/buy-fiat.service';
import { createCustomSell } from '../__mocks__/sell.entity.mock';
import { createCustomDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { SellRepository } from '../sell.repository';
import { SellService } from '../sell.service';
import { GetSellPaymentInfoDto } from '../dto/get-sell-payment-info.dto';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';

describe('SellService - Gasless Integration', () => {
  let service: SellService;

  let sellRepo: SellRepository;
  let depositService: DepositService;
  let userService: UserService;
  let userDataService: UserDataService;
  let assetService: AssetService;
  let payInService: PayInService;
  let buyFiatService: BuyFiatService;
  let transactionUtilService: TransactionUtilService;
  let routeService: RouteService;
  let bankDataService: BankDataService;
  let transactionHelper: TransactionHelper;
  let cryptoService: CryptoService;
  let transactionRequestService: TransactionRequestService;
  let blockchainRegistryService: BlockchainRegistryService;
  let eip7702RelayerService: Eip7702RelayerService;

  const mockDepositAddress = '0xDepositAddress123456789012345678901234';
  const mockUserAddress = '0xUserAddress12345678901234567890123456';
  const mockDelegationContract = '0xDelegationContract1234567890123456789';

  beforeEach(async () => {
    sellRepo = createMock<SellRepository>();
    depositService = createMock<DepositService>();
    userService = createMock<UserService>();
    userDataService = createMock<UserDataService>();
    assetService = createMock<AssetService>();
    payInService = createMock<PayInService>();
    buyFiatService = createMock<BuyFiatService>();
    transactionUtilService = createMock<TransactionUtilService>();
    routeService = createMock<RouteService>();
    bankDataService = createMock<BankDataService>();
    transactionHelper = createMock<TransactionHelper>();
    cryptoService = createMock<CryptoService>();
    transactionRequestService = createMock<TransactionRequestService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    eip7702RelayerService = createMock<Eip7702RelayerService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellService,
        { provide: SellRepository, useValue: sellRepo },
        { provide: DepositService, useValue: depositService },
        { provide: UserService, useValue: userService },
        { provide: UserDataService, useValue: userDataService },
        { provide: AssetService, useValue: assetService },
        { provide: PayInService, useValue: payInService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: RouteService, useValue: routeService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CryptoService, useValue: cryptoService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: Eip7702RelayerService, useValue: eip7702RelayerService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<SellService>(SellService);
  });

  describe('isGaslessSupported', () => {
    // Access private method for testing
    const callIsGaslessSupported = (blockchain: Blockchain): boolean => {
      return (service as any).isGaslessSupported(blockchain);
    };

    it('should return true for Ethereum', () => {
      expect(callIsGaslessSupported(Blockchain.ETHEREUM)).toBe(true);
    });

    it('should return false for Arbitrum (not yet supported)', () => {
      expect(callIsGaslessSupported(Blockchain.ARBITRUM)).toBe(false);
    });

    it('should return false for Optimism (not yet supported)', () => {
      expect(callIsGaslessSupported(Blockchain.OPTIMISM)).toBe(false);
    });

    it('should return false for Polygon (not yet supported)', () => {
      expect(callIsGaslessSupported(Blockchain.POLYGON)).toBe(false);
    });

    it('should return false for Base (not yet supported)', () => {
      expect(callIsGaslessSupported(Blockchain.BASE)).toBe(false);
    });

    it('should return false for Bitcoin', () => {
      expect(callIsGaslessSupported(Blockchain.BITCOIN)).toBe(false);
    });

    it('should return false for Lightning', () => {
      expect(callIsGaslessSupported(Blockchain.LIGHTNING)).toBe(false);
    });

    it('should return false for Solana', () => {
      expect(callIsGaslessSupported(Blockchain.SOLANA)).toBe(false);
    });

    it('should return false for BSC', () => {
      expect(callIsGaslessSupported(Blockchain.BINANCE_SMART_CHAIN)).toBe(false);
    });
  });

  describe('prepareGaslessData', () => {
    const callPrepareGaslessData = async (
      userAddress: string,
      depositAddress: string,
      dto: GetSellPaymentInfoDto,
      amount: number,
    ) => {
      return (service as any).prepareGaslessData(userAddress, depositAddress, dto, amount);
    };

    const mockEip712Data = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Transfer: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Transfer',
      domain: {
        name: 'DfxGaslessSell',
        version: '1',
        chainId: 1,
        verifyingContract: mockUserAddress,
      },
      message: {
        token: '0xTokenAddress',
        amount: '1000000000000000000',
        recipient: mockDepositAddress,
        nonce: 5,
        deadline: 1703289600,
      },
    };

    beforeEach(() => {
      jest.spyOn(eip7702RelayerService, 'prepareGaslessTransfer').mockResolvedValue({
        nonce: 5,
        deadline: 1703289600,
        delegationContract: mockDelegationContract,
        eip712Data: mockEip712Data,
      });
    });

    it('should prepare gasless data with correct parameters', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 1,
      } as GetSellPaymentInfoDto;

      const result = await callPrepareGaslessData(mockUserAddress, mockDepositAddress, dto, 1);

      expect(eip7702RelayerService.prepareGaslessTransfer).toHaveBeenCalledWith({
        userAddress: mockUserAddress,
        tokenAddress: '0xTokenAddress',
        amount: '1000000000000000000', // 1 * 10^18
        recipient: mockDepositAddress,
        deadlineMinutes: 60,
      });

      expect(result).toEqual({
        nonce: 5,
        deadline: 1703289600,
        delegationContract: mockDelegationContract,
        eip712Data: mockEip712Data,
      });
    });

    it('should convert amount to wei based on asset decimals', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xUSDCAddress',
          decimals: 6, // USDC has 6 decimals
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 100,
      } as GetSellPaymentInfoDto;

      await callPrepareGaslessData(mockUserAddress, mockDepositAddress, dto, 100);

      expect(eip7702RelayerService.prepareGaslessTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '100000000', // 100 * 10^6
        }),
      );
    });

    it('should use deposit address as recipient', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 1,
      } as GetSellPaymentInfoDto;

      const customDepositAddress = '0xCustomDepositAddress1234567890123456';
      await callPrepareGaslessData(mockUserAddress, customDepositAddress, dto, 1);

      expect(eip7702RelayerService.prepareGaslessTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: customDepositAddress,
        }),
      );
    });
  });

  describe('toPaymentInfoDto - gasless integration', () => {
    const mockSell = createCustomSell({
      id: 123,
      iban: 'DE89370400440532013000',
      active: true,
      deposit: createCustomDeposit({
        address: mockDepositAddress,
        blockchains: Blockchain.ETHEREUM,
      }),
    });

    const mockUser = createCustomUser({
      id: 1,
      address: mockUserAddress,
    });

    const mockTxDetails = {
      timestamp: new Date(),
      minVolume: 10,
      minVolumeTarget: 10,
      maxVolume: 10000,
      maxVolumeTarget: 10000,
      exchangeRate: 1,
      rate: 0.99,
      estimatedAmount: 99,
      sourceAmount: 100,
      isValid: true,
      error: undefined,
      exactPrice: false,
      feeSource: { rate: 0.01, min: 1, max: 100, network: 0, total: 1 },
      feeTarget: { rate: 0.01, min: 1, max: 100, network: 0, total: 1 },
      priceSteps: [],
    };

    beforeEach(() => {
      jest.spyOn(userService, 'getUser').mockResolvedValue(mockUser as any);
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue(mockTxDetails as any);
      jest.spyOn(cryptoService, 'getPaymentRequest').mockResolvedValue(undefined);
      jest.spyOn(transactionRequestService, 'create').mockResolvedValue({ id: 1, uid: 'test-uid' } as any);
      jest.spyOn(eip7702RelayerService, 'prepareGaslessTransfer').mockResolvedValue({
        nonce: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        delegationContract: mockDelegationContract,
        eip712Data: {} as any,
      });
    });

    it('should include gaslessData when gasless=true and blockchain is Ethereum', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 100,
        gasless: true,
      } as GetSellPaymentInfoDto;

      // Call the private method via service method
      const result = await (service as any).toPaymentInfoDto(1, mockSell, dto, false);

      expect(result.gaslessData).toBeDefined();
      expect(result.gaslessData.delegationContract).toBe(mockDelegationContract);
    });

    it('should NOT include gaslessData when gasless=false', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 100,
        gasless: false,
      } as GetSellPaymentInfoDto;

      const result = await (service as any).toPaymentInfoDto(1, mockSell, dto, false);

      expect(result.gaslessData).toBeUndefined();
    });

    it('should NOT include gaslessData when blockchain is not supported', async () => {
      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.BITCOIN, // Not supported
        }),
        currency: createDefaultFiat(),
        amount: 100,
        gasless: true,
      } as GetSellPaymentInfoDto;

      const result = await (service as any).toPaymentInfoDto(1, mockSell, dto, false);

      expect(result.gaslessData).toBeUndefined();
    });

    it('should NOT include gaslessData when quote is invalid', async () => {
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue({
        ...mockTxDetails,
        isValid: false,
        error: 'AMOUNT_TOO_LOW' as any,
      } as any);

      const dto: GetSellPaymentInfoDto = {
        asset: createCustomAsset({
          chainId: '0xTokenAddress',
          decimals: 18,
          blockchain: Blockchain.ETHEREUM,
        }),
        currency: createDefaultFiat(),
        amount: 0.001, // Too low
        gasless: true,
      } as GetSellPaymentInfoDto;

      const result = await (service as any).toPaymentInfoDto(1, mockSell, dto, false);

      expect(result.gaslessData).toBeUndefined();
      expect(result.isValid).toBe(false);
    });
  });

  describe('confirmSell - gasless flow', () => {
    const mockSell = createCustomSell({
      id: 123,
      iban: 'DE89370400440532013000',
      active: true,
      deposit: createCustomDeposit({
        address: mockDepositAddress,
        blockchains: Blockchain.ETHEREUM,
      }),
    });

    const mockTransactionRequest = {
      id: 456,
      routeId: 123,
      sourceId: 1,
      amount: 100,
      isValid: true,
      isComplete: false,
      user: createCustomUser({ id: 1, address: mockUserAddress }),
    };

    const mockPayIn = {
      id: 789,
      inTxId: '0xTxHash123',
    };

    const mockBuyFiat = {
      id: 101,
      inputAmount: 100,
    };

    const validGaslessDto = {
      userAddress: mockUserAddress,
      tokenAddress: '0xTokenAddress123456789012345678901234567',
      amount: '100000000000000000000',
      recipient: mockDepositAddress,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      signature: {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    };

    beforeEach(() => {
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(mockSell as any);
      jest.spyOn(transactionUtilService, 'handleGaslessInput').mockResolvedValue(mockPayIn as any);
      jest.spyOn(buyFiatService, 'createFromCryptoInput').mockResolvedValue(mockBuyFiat as any);
      jest.spyOn(payInService, 'acknowledgePayIn').mockResolvedValue(undefined);
      jest.spyOn(buyFiatService, 'extendBuyFiat').mockResolvedValue({ ...mockBuyFiat, extended: true } as any);
    });

    it('should execute gasless flow successfully', async () => {
      const result = await service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto });

      expect(result).toBeDefined();
      expect(transactionUtilService.handleGaslessInput).toHaveBeenCalledWith(
        mockSell,
        mockTransactionRequest,
        validGaslessDto,
      );
      expect(buyFiatService.createFromCryptoInput).toHaveBeenCalledWith(mockPayIn, mockSell, mockTransactionRequest);
      expect(payInService.acknowledgePayIn).toHaveBeenCalled();
    });

    it('should throw BadRequestException when neither permit, gasless, nor signedTxHex provided', async () => {
      await expect(service.confirmSell(mockTransactionRequest as any, {})).rejects.toThrow(
        'Either permit, gasless, or signedTxHex must be provided',
      );
    });

    it('should throw NotFoundException when sell route not found', async () => {
      jest.spyOn(sellRepo, 'findOne').mockResolvedValue(null);

      await expect(service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto })).rejects.toThrow(
        'Sell route not found',
      );
    });

    it('should wrap handleGaslessInput errors in BadRequestException', async () => {
      jest.spyOn(transactionUtilService, 'handleGaslessInput').mockRejectedValue(new Error('Token mismatch'));

      await expect(service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto })).rejects.toThrow(
        'Failed to confirm request: Token mismatch',
      );
    });

    it('should call handleGaslessInput with correct route and request', async () => {
      await service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto });

      expect(transactionUtilService.handleGaslessInput).toHaveBeenCalledWith(
        expect.objectContaining({ id: 123, deposit: expect.objectContaining({ address: mockDepositAddress }) }),
        expect.objectContaining({ id: 456, routeId: 123 }),
        validGaslessDto,
      );
    });

    it('should acknowledge payIn after creating buyFiat', async () => {
      const callOrder: string[] = [];

      jest.spyOn(buyFiatService, 'createFromCryptoInput').mockImplementation(async () => {
        callOrder.push('createFromCryptoInput');
        return mockBuyFiat as any;
      });

      jest.spyOn(payInService, 'acknowledgePayIn').mockImplementation(async () => {
        callOrder.push('acknowledgePayIn');
        return undefined;
      });

      await service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto });

      expect(callOrder).toEqual(['createFromCryptoInput', 'acknowledgePayIn']);
    });

    it('should return extended buyFiat', async () => {
      const extendedBuyFiat = { ...mockBuyFiat, extended: true, userData: {} };
      jest.spyOn(buyFiatService, 'extendBuyFiat').mockResolvedValue(extendedBuyFiat as any);

      const result = await service.confirmSell(mockTransactionRequest as any, { gasless: validGaslessDto });

      expect(result).toEqual(extendedBuyFiat);
      expect(buyFiatService.extendBuyFiat).toHaveBeenCalledWith(mockBuyFiat);
    });
  });
});
