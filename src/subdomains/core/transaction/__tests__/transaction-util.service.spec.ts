import { BadRequestException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702RelayerService } from 'src/integration/blockchain/shared/evm/eip7702/eip7702-relayer.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { CryptoInput, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { GaslessDto } from 'src/subdomains/core/sell-crypto/route/dto/confirm.dto';
import { createCustomSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { createCustomDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { TransactionUtilService } from '../transaction-util.service';

describe('TransactionUtilService', () => {
  let service: TransactionUtilService;

  let assetService: AssetService;
  let blockchainRegistry: BlockchainRegistryService;
  let txValidationService: TxValidationService;
  let payInService: PayInService;
  let bankAccountService: BankAccountService;
  let specialExternalAccountService: SpecialExternalAccountService;
  let eip7702RelayerService: Eip7702RelayerService;

  const mockUserAddress = '0xUser1234567890123456789012345678901234';
  const mockTokenAddress = '0xToken123456789012345678901234567890123';
  const mockRecipientAddress = '0xRecipient123456789012345678901234567890';
  const mockTxHash = '0xTransactionHash12345678901234567890123456789012345678901234';

  beforeEach(async () => {
    assetService = createMock<AssetService>();
    blockchainRegistry = createMock<BlockchainRegistryService>();
    txValidationService = createMock<TxValidationService>();
    payInService = createMock<PayInService>();
    bankAccountService = createMock<BankAccountService>();
    specialExternalAccountService = createMock<SpecialExternalAccountService>();
    eip7702RelayerService = createMock<Eip7702RelayerService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionUtilService,
        { provide: AssetService, useValue: assetService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistry },
        { provide: TxValidationService, useValue: txValidationService },
        { provide: PayInService, useValue: payInService },
        { provide: BankAccountService, useValue: bankAccountService },
        { provide: SpecialExternalAccountService, useValue: specialExternalAccountService },
        { provide: Eip7702RelayerService, useValue: eip7702RelayerService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<TransactionUtilService>(TransactionUtilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleGaslessInput', () => {
    const mockAsset = createCustomAsset({
      id: 1,
      chainId: mockTokenAddress,
      decimals: 18,
      blockchain: Blockchain.ETHEREUM,
    });

    const mockSell = createCustomSell({
      id: 123,
      deposit: createCustomDeposit({
        address: mockRecipientAddress,
        blockchains: Blockchain.ETHEREUM,
      }),
    });

    const mockTransactionRequest: Partial<TransactionRequest> = {
      id: 456,
      sourceId: 1,
      amount: 100,
    };

    const validGaslessDto: GaslessDto = {
      userAddress: mockUserAddress,
      tokenAddress: mockTokenAddress,
      amount: '100000000000000000000', // 100 tokens
      recipient: mockRecipientAddress,
      deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      signature: {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    };

    const mockCryptoInput: Partial<CryptoInput> = {
      id: 789,
      inTxId: mockTxHash,
      txType: PayInType.GASLESS_TRANSFER,
    };

    const mockEvmClient = {
      getCurrentBlock: jest.fn().mockResolvedValue(12345678),
    };

    beforeEach(() => {
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(mockAsset);
      jest.spyOn(eip7702RelayerService, 'isRecipientAllowed').mockReturnValue(true);
      jest.spyOn(eip7702RelayerService, 'executeGaslessTransfer').mockResolvedValue({
        success: true,
        txHash: mockTxHash,
      });
      jest.spyOn(blockchainRegistry, 'getEvmClient').mockReturnValue(mockEvmClient as any);
      jest.spyOn(payInService, 'createPayIn').mockResolvedValue(mockCryptoInput as CryptoInput);
    });

    it('should execute gasless transfer successfully', async () => {
      const result = await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        validGaslessDto,
      );

      expect(result).toBeDefined();
      expect(result.inTxId).toBe(mockTxHash);
      expect(result.txType).toBe(PayInType.GASLESS_TRANSFER);
    });

    it('should call eip7702RelayerService.executeGaslessTransfer with correct params', async () => {
      await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        validGaslessDto,
      );

      // Uses asset.chainId and route.deposit.address instead of dto values
      expect(eip7702RelayerService.executeGaslessTransfer).toHaveBeenCalledWith({
        userAddress: validGaslessDto.userAddress,
        tokenAddress: mockAsset.chainId,
        amount: validGaslessDto.amount,
        recipient: mockRecipientAddress,
        deadline: validGaslessDto.deadline,
        signature: validGaslessDto.signature,
      });
    });

    it('should create PayIn with correct parameters', async () => {
      await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        validGaslessDto,
      );

      // Uses route.deposit.address instead of dto.recipient for consistency
      expect(payInService.createPayIn).toHaveBeenCalledWith(
        validGaslessDto.userAddress,
        mockRecipientAddress, // route.deposit.address
        mockAsset,
        mockTxHash,
        PayInType.GASLESS_TRANSFER,
        12345678, // blockHeight
        mockTransactionRequest.amount,
      );
    });

    it('should throw BadRequestException if asset not found', async () => {
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(null);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow('Asset not found');
    });

    it('should throw BadRequestException if token address does not match asset', async () => {
      const wrongTokenDto: GaslessDto = {
        ...validGaslessDto,
        tokenAddress: '0xWrongToken12345678901234567890123456789',
      };

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          wrongTokenDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          wrongTokenDto,
        ),
      ).rejects.toThrow('Token address does not match asset');
    });

    it('should throw BadRequestException if recipient does not match deposit address', async () => {
      const wrongRecipientDto: GaslessDto = {
        ...validGaslessDto,
        recipient: '0xWrongRecipient1234567890123456789012345',
      };

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          wrongRecipientDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          wrongRecipientDto,
        ),
      ).rejects.toThrow('Recipient does not match deposit address');
    });

    it('should throw BadRequestException if deposit address is not in allowed recipients', async () => {
      jest.spyOn(eip7702RelayerService, 'isRecipientAllowed').mockReturnValue(false);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow('Deposit address not in allowed recipients');
    });

    it('should throw BadRequestException if deadline has passed', async () => {
      const expiredDto: GaslessDto = {
        ...validGaslessDto,
        deadline: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
      };

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          expiredDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          expiredDto,
        ),
      ).rejects.toThrow('Signature deadline has passed');
    });

    it('should throw BadRequestException if gasless transfer fails', async () => {
      jest.spyOn(eip7702RelayerService, 'executeGaslessTransfer').mockResolvedValue({
        success: false,
        error: 'Insufficient balance',
      });

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow('Gasless transfer failed: Insufficient balance');
    });

    it('should throw BadRequestException if gasless transfer fails with invalid signature', async () => {
      jest.spyOn(eip7702RelayerService, 'executeGaslessTransfer').mockResolvedValue({
        success: false,
        error: 'Invalid signature',
      });

      await expect(
        service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          validGaslessDto,
        ),
      ).rejects.toThrow('Gasless transfer failed: Invalid signature');
    });

    it('should get current block height from blockchain client', async () => {
      await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        validGaslessDto,
      );

      expect(blockchainRegistry.getEvmClient).toHaveBeenCalledWith(mockAsset.blockchain);
      expect(mockEvmClient.getCurrentBlock).toHaveBeenCalled();
    });

    it('should validate deposit address is in allowed recipients', async () => {
      await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        validGaslessDto,
      );

      // Uses route.deposit.address instead of dto.recipient
      expect(eip7702RelayerService.isRecipientAllowed).toHaveBeenCalledWith(mockRecipientAddress);
    });

    it('should check deadline before executing transfer', async () => {
      const futureDto: GaslessDto = {
        ...validGaslessDto,
        deadline: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
      };

      await service.handleGaslessInput(
        mockSell as any,
        mockTransactionRequest as TransactionRequest,
        futureDto,
      );

      // Should not throw, transfer should be executed
      expect(eip7702RelayerService.executeGaslessTransfer).toHaveBeenCalled();
    });

    describe('amount edge cases', () => {
      it('should handle zero amount in dto (validation at contract level)', async () => {
        const zeroAmountDto: GaslessDto = {
          ...validGaslessDto,
          amount: '0',
        };

        // Zero amount passes validation at service level
        // Smart contract should reject, but we test the service doesn't throw
        await service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          zeroAmountDto,
        );

        expect(eip7702RelayerService.executeGaslessTransfer).toHaveBeenCalledWith(
          expect.objectContaining({ amount: '0' }),
        );
      });

      it('should handle very large amount (18 decimals max supply)', async () => {
        // 1 billion tokens with 18 decimals
        const largeAmount = '1000000000000000000000000000';
        const largeAmountDto: GaslessDto = {
          ...validGaslessDto,
          amount: largeAmount,
        };

        await service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          largeAmountDto,
        );

        expect(eip7702RelayerService.executeGaslessTransfer).toHaveBeenCalledWith(
          expect.objectContaining({ amount: largeAmount }),
        );
      });

      it('should handle amount with trailing zeros correctly', async () => {
        const amountWithZeros = '100000000000000000000'; // 100 * 10^18
        const dto: GaslessDto = {
          ...validGaslessDto,
          amount: amountWithZeros,
        };

        await service.handleGaslessInput(
          mockSell as any,
          mockTransactionRequest as TransactionRequest,
          dto,
        );

        expect(eip7702RelayerService.executeGaslessTransfer).toHaveBeenCalledWith(
          expect.objectContaining({ amount: amountWithZeros }),
        );
      });

      it('should use request.amount for PayIn creation, not dto.amount', async () => {
        // dto.amount is in wei, request.amount is in token units
        const weiAmount = '5000000000000000000'; // 5 tokens in wei
        const requestAmount = 5; // 5 tokens

        const dto: GaslessDto = {
          ...validGaslessDto,
          amount: weiAmount,
        };

        const request = {
          ...mockTransactionRequest,
          amount: requestAmount,
        };

        await service.handleGaslessInput(mockSell as any, request as TransactionRequest, dto);

        // PayIn should use request.amount (token units), not dto.amount (wei)
        expect(payInService.createPayIn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(Object),
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          requestAmount, // Not weiAmount
        );
      });
    });
  });
});
