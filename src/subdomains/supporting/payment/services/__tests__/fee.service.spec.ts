import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { PriceInvalidException } from 'src/subdomains/supporting/pricing/domain/exceptions/price-invalid.exception';
import { BankService } from '../../../bank/bank/bank.service';
import { PayoutService } from '../../../payout/services/payout.service';
import { PricingService } from '../../../pricing/services/pricing.service';
import { BlockchainFeeRepository } from '../../repositories/blockchain-fee.repository';
import { FeeRepository } from '../../repositories/fee.repository';
import { FeeService } from '../fee.service';

describe('FeeService', () => {
  let service: FeeService;
  let blockchainFeeRepo: MockProxy<BlockchainFeeRepository>;

  beforeAll(async () => {
    blockchainFeeRepo = mock<BlockchainFeeRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FeeRepository, useValue: mock<FeeRepository>() },
        { provide: AssetService, useValue: mock<AssetService>() },
        { provide: FiatService, useValue: mock<FiatService>() },
        { provide: UserDataService, useValue: mock<UserDataService>() },
        { provide: SettingService, useValue: mock<SettingService>() },
        { provide: WalletService, useValue: mock<WalletService>() },
        { provide: BlockchainFeeRepository, useValue: blockchainFeeRepo },
        { provide: PayoutService, useValue: mock<PayoutService>() },
        { provide: PricingService, useValue: mock<PricingService>() },
        { provide: BankService, useValue: mock<BankService>() },
        FeeService,
      ],
    }).compile();

    service = module.get<FeeService>(FeeService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('updateBlockchainFees', () => {
    const feeRow = (updated: Date) => [{ asset: { id: 398 }, amount: 1, updated } as any];

    it('logs a fresh price outage at warn and keeps the stored fee', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date()));
      jest
        .spyOn(service as any, 'calculateBlockchainFeeInChf')
        .mockRejectedValue(new PriceInvalidException('No valid price found for ETH -> CHF'));
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(
        LogLevel.WARN,
        expect.stringContaining('398'),
        expect.any(PriceInvalidException),
      );
      expect(blockchainFeeRepo.save).not.toHaveBeenCalled();
    });

    it('escalates a persistent price outage to error once the stored fee goes stale', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date(Date.now() - 31 * 60 * 1000)));
      jest
        .spyOn(service as any, 'calculateBlockchainFeeInChf')
        .mockRejectedValue(new PriceInvalidException('No price rule found for asset ETH'));
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(
        LogLevel.ERROR,
        expect.stringContaining('398'),
        expect.any(PriceInvalidException),
      );
    });

    it('keeps unexpected failures at error', async () => {
      blockchainFeeRepo.find.mockResolvedValue(feeRow(new Date()));
      jest.spyOn(service as any, 'calculateBlockchainFeeInChf').mockRejectedValue(new Error('estimation failed'));
      const loggerLog = jest.spyOn(DfxLogger.prototype, 'log').mockImplementation();

      await service.updateBlockchainFees();

      expect(loggerLog).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining('398'), expect.any(Error));
    });
  });

  describe('describeFeeRequest', () => {
    it('logs identifying scalars only, never entity internals', () => {
      const user = createCustomUser({
        id: 42,
        address: '0x6B59e3BFF9C3ccC0F2FA59Ea7cc4245ae2F1fE64',
        signature: 'SECRET_SIGNATURE',
        ip: '203.0.113.7',
      });
      const request = {
        user,
        paymentMethodIn: 'Bank',
        bankIn: 'Olkypay',
        from: createCustomAsset({ name: 'ETH' }),
        specialCodes: [],
        allowCachedBlockchainFee: false,
      };

      const description = (service as any).describeFeeRequest(request);

      expect(description).toContain('42');
      expect(description).not.toContain('SECRET_SIGNATURE');
      expect(description).not.toContain('0x6B59e3BFF9C3ccC0F2FA59Ea7cc4245ae2F1fE64');
      expect(description).not.toContain('203.0.113.7');
    });
  });
});
