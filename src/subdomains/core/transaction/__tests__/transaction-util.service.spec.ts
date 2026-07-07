import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionUtilService } from '../transaction-util.service';

describe('TransactionUtilService', () => {
  let service: TransactionUtilService;

  let assetService: AssetService;
  let blockchainRegistry: BlockchainRegistryService;
  let txValidationService: TxValidationService;
  let payInService: PayInService;
  let bankAccountService: BankAccountService;
  let specialExternalAccountService: SpecialExternalAccountService;

  beforeEach(async () => {
    assetService = createMock<AssetService>();
    blockchainRegistry = createMock<BlockchainRegistryService>();
    txValidationService = createMock<TxValidationService>();
    payInService = createMock<PayInService>();
    bankAccountService = createMock<BankAccountService>();
    specialExternalAccountService = createMock<SpecialExternalAccountService>();

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
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<TransactionUtilService>(TransactionUtilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleTxHashInput', () => {
    const txHash = '0xb1f2c3a4d5e6f70819a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f70';

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

    let evmClient: { getTx: jest.Mock; getCurrentBlock: jest.Mock };

    beforeEach(() => {
      evmClient = { getTx: jest.fn(), getCurrentBlock: jest.fn().mockResolvedValue(1234) };

      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(mockAsset as any);
      jest.spyOn(blockchainRegistry, 'getEvmClient').mockReturnValue(evmClient as any);
    });

    it('creates a pay-in when the transaction exists on-chain', async () => {
      evmClient.getTx.mockResolvedValue({ hash: txHash });

      await service.handleTxHashInput(mockRoute as any, mockRequest as any, txHash);

      expect(evmClient.getTx).toHaveBeenCalledWith(txHash);
      expect(payInService.createPayIn).toHaveBeenCalledWith(
        mockRequest.user.address,
        mockRoute.deposit.address,
        mockAsset,
        txHash,
        PayInType.CONFIRMED_DEPOSIT,
        1234,
        mockRequest.amount,
      );
    });

    it('throws when the transaction is not found on-chain', async () => {
      evmClient.getTx.mockResolvedValue(null);

      await expect(service.handleTxHashInput(mockRoute as any, mockRequest as any, txHash)).rejects.toThrow(
        BadRequestException,
      );
      expect(payInService.createPayIn).not.toHaveBeenCalled();
    });

    it('passes on RPC errors', async () => {
      evmClient.getTx.mockRejectedValue(new Error('could not detect network'));

      await expect(service.handleTxHashInput(mockRoute as any, mockRequest as any, txHash)).rejects.toThrow(
        'could not detect network',
      );
      expect(payInService.createPayIn).not.toHaveBeenCalled();
    });
  });
});
