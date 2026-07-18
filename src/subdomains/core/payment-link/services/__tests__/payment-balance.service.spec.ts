import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';
import { PaymentBalanceService } from '../payment-balance.service';

describe('PaymentBalanceService', () => {
  let service: PaymentBalanceService;

  let assetService: AssetService;
  let blockchainRegistryService: BlockchainRegistryService;
  let bitcoinFeeService: BitcoinFeeService;

  beforeEach(async () => {
    assetService = createMock<AssetService>();
    blockchainRegistryService = createMock<BlockchainRegistryService>();
    bitcoinFeeService = createMock<BitcoinFeeService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentBalanceService,
        { provide: AssetService, useValue: assetService },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: BitcoinFeeService, useValue: bitcoinFeeService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<PaymentBalanceService>(PaymentBalanceService);
  });

  afterEach(() => jest.restoreAllMocks());

  const solanaCoin = () =>
    createCustomAsset({
      id: 1,
      blockchain: Blockchain.SOLANA,
      type: AssetType.COIN,
      paymentEnabled: true,
      chainId: 'So11111111111111111111111111111111111111112',
    });

  describe('#getPaymentBalances', () => {
    it('skips an unconfigured client with a single warning and no error', async () => {
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);
      const getBalance = jest.fn();
      jest
        .spyOn(blockchainRegistryService, 'getClient')
        .mockReturnValue({ isConfigured: false, getNativeCoinBalanceForAddress: getBalance } as any);

      const first = await service.getPaymentBalances([solanaCoin()], true);
      const second = await service.getPaymentBalances([solanaCoin()], true);

      expect(first.size).toBe(0);
      expect(second.size).toBe(0);
      expect(getBalance).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Solana'));
    });

    it('fetches balances from a configured client', async () => {
      jest.spyOn(blockchainRegistryService, 'getClient').mockReturnValue({
        isConfigured: true,
        getNativeCoinBalanceForAddress: jest.fn().mockResolvedValue(1.5),
        getTokenBalances: jest.fn().mockResolvedValue([]),
      } as any);
      service['solanaDepositAddress'] = 'SolTestDepositAddress';

      const balances = await service.getPaymentBalances([solanaCoin()], true);

      expect(balances.get(1)).toEqual({
        owner: 'SolTestDepositAddress',
        contractAddress: 'So11111111111111111111111111111111111111112',
        balance: 1.5,
      });
    });

    it('keeps a failing configured client visible as an error', async () => {
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(blockchainRegistryService, 'getClient').mockReturnValue({
        isConfigured: true,
        getNativeCoinBalanceForAddress: jest.fn().mockRejectedValue(new Error('getBalance rejected')),
      } as any);
      service['solanaDepositAddress'] = 'SolTestDepositAddress';

      await expect(service.getPaymentBalances([solanaCoin()], false)).rejects.toThrow('getBalance rejected');

      const balances = await service.getPaymentBalances([solanaCoin()], true);

      expect(balances.size).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Solana'), expect.any(Error));
    });
  });
});
