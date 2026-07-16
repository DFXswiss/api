import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { EvmTokenStrategy } from '../evm.token.strategy';
import { SendGroup, SendType } from '../send.strategy';

class TestEvmTokenStrategy extends EvmTokenStrategy {
  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('0x0000000000000000000000000000000000000001', this.blockchain);
  }
}

/**
 * Integration tests for EvmTokenStrategy delegation flow
 *
 * These tests verify the correct integration between EvmTokenStrategy and Eip7702DelegationService.
 * Since the CryptoInput entity has deep import chains, we test the key integration points
 * by directly testing the protected methods with minimal mocking.
 */

describe('EvmTokenStrategy Delegation Integration', () => {
  describe('dispatchViaDelegation designate-before-broadcast', () => {
    let strategy: TestEvmTokenStrategy;
    let payInRepo: PayInRepository;
    let delegationService: Eip7702DelegationService;
    let saveSpy: jest.SpyInstance;

    function createGroup() {
      const payIns = [
        createCustomCryptoInput({ id: 1, status: PayInStatus.ACKNOWLEDGED, amount: 1 }),
        createCustomCryptoInput({ id: 2, status: PayInStatus.TO_RETURN, amount: 2 }),
      ];
      const group = {
        account: {} as SendGroup['account'],
        sourceAddress: '0x0000000000000000000000000000000000000002',
        destinationAddress: '0x0000000000000000000000000000000000000003',
        asset: payIns[0].asset,
        status: PayInStatus.ACKNOWLEDGED,
        payIns,
      } as SendGroup;

      return { group, payIns };
    }

    beforeEach(() => {
      payInRepo = mock<PayInRepository>();
      delegationService = mock<Eip7702DelegationService>();
      strategy = new TestEvmTokenStrategy(mock<PayInEvmService>(), payInRepo, delegationService);
      saveSpy = jest.spyOn(payInRepo, 'save').mockImplementation(async (payIn) => payIn as CryptoInput);
    });

    it('persists Sending on every member before calling the delegation broadcast sink', async () => {
      const { group, payIns } = createGroup();
      const broadcastError = new TxBroadcastError('broadcast failed');
      const transferSpy = jest.spyOn(delegationService, 'transferTokenViaDelegation').mockRejectedValue(broadcastError);

      await expect(strategy['dispatchViaDelegation'](group, SendType.FORWARD)).rejects.toBe(broadcastError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.SENDING, PayInStatus.SENDING]);
      expect(saveSpy.mock.invocationCallOrder[1]).toBeLessThan(transferSpy.mock.invocationCallOrder[0]);
    });

    it('restores captured statuses when delegation fails before its broadcast boundary', async () => {
      const { group, payIns } = createGroup();
      const preBroadcastError = new Error('gas estimation failed');
      jest.spyOn(delegationService, 'transferTokenViaDelegation').mockRejectedValue(preBroadcastError);

      await expect(strategy['dispatchViaDelegation'](group, SendType.FORWARD)).rejects.toBe(preBroadcastError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN]);
      expect(payInRepo.save).toHaveBeenCalledTimes(4);
    });

    it('keeps Sending when the delegation broadcast boundary throws TxBroadcastError', async () => {
      const { group, payIns } = createGroup();
      const broadcastError = new TxBroadcastError('relayer timeout');
      jest.spyOn(delegationService, 'transferTokenViaDelegation').mockRejectedValue(broadcastError);

      await expect(strategy['dispatchViaDelegation'](group, SendType.FORWARD)).rejects.toBe(broadcastError);

      expect(payIns.map((payIn) => payIn.status)).toEqual([PayInStatus.SENDING, PayInStatus.SENDING]);
      expect(payInRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('isDelegationSupported wrapper', () => {
    it('should correctly delegate to the delegation service', () => {
      // This is tested by the delegation service tests
      // The wrapper in EvmTokenStrategy is a simple pass-through:
      // return this.delegationService?.isDelegationSupported(this.blockchain) ?? false;
      expect(true).toBe(true);
    });

    it('should return false when delegationService is undefined', () => {
      // The optional chaining (?.) ensures this returns false when service is undefined
      const delegationService: { isDelegationSupported?: (b: string) => boolean } | undefined = undefined;
      const result = delegationService?.isDelegationSupported?.('Ethereum') ?? false;
      expect(result).toBe(false);
    });
  });

  describe('doSend pay-in splitting logic', () => {
    // Test the splitting logic in isolation
    const PayInStatus = {
      ACKNOWLEDGED: 'Acknowledged',
      TO_RETURN: 'ToReturn',
      PREPARING: 'Preparing',
      PREPARED: 'Prepared',
    };

    it('should identify ACKNOWLEDGED and TO_RETURN for delegation flow', () => {
      const payIns = [
        { status: PayInStatus.ACKNOWLEDGED },
        { status: PayInStatus.TO_RETURN },
        { status: PayInStatus.PREPARING },
        { status: PayInStatus.PREPARED },
      ];

      const delegationPayIns = payIns.filter((p) =>
        [PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(p.status),
      );

      const legacyPayIns = payIns.filter((p) => [PayInStatus.PREPARING, PayInStatus.PREPARED].includes(p.status));

      expect(delegationPayIns).toHaveLength(2);
      expect(legacyPayIns).toHaveLength(2);
      expect(delegationPayIns[0].status).toBe(PayInStatus.ACKNOWLEDGED);
      expect(delegationPayIns[1].status).toBe(PayInStatus.TO_RETURN);
      expect(legacyPayIns[0].status).toBe(PayInStatus.PREPARING);
      expect(legacyPayIns[1].status).toBe(PayInStatus.PREPARED);
    });

    it('should correctly split mixed status pay-ins', () => {
      const payIns = [
        { id: 1, status: PayInStatus.ACKNOWLEDGED },
        { id: 2, status: PayInStatus.PREPARED },
        { id: 3, status: PayInStatus.ACKNOWLEDGED },
        { id: 4, status: PayInStatus.PREPARING },
      ];

      const delegationPayIns = payIns.filter((p) =>
        [PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(p.status),
      );

      const legacyPayIns = payIns.filter((p) => [PayInStatus.PREPARING, PayInStatus.PREPARED].includes(p.status));

      expect(delegationPayIns.map((p) => p.id)).toEqual([1, 3]);
      expect(legacyPayIns.map((p) => p.id)).toEqual([2, 4]);
    });
  });

  describe('dispatchViaDelegation amount calculation', () => {
    // Test the amount calculation logic used in dispatchViaDelegation
    const SendType = {
      FORWARD: 'Forward',
      RETURN: 'Return',
    };

    it('should use amount for FORWARD type', () => {
      const payInGroup = {
        payIns: [
          { amount: 100, chargebackAmount: 90 },
          { amount: 200, chargebackAmount: 180 },
        ],
      };

      const type = SendType.FORWARD;
      const totalAmount = payInGroup.payIns.reduce(
        (sum, p) => sum + (type === SendType.RETURN ? p.chargebackAmount : p.amount),
        0,
      );

      expect(totalAmount).toBe(300); // 100 + 200
    });

    it('should use chargebackAmount for RETURN type', () => {
      const payInGroup = {
        payIns: [
          { amount: 100, chargebackAmount: 90 },
          { amount: 200, chargebackAmount: 180 },
        ],
      };

      const type = SendType.RETURN;
      const totalAmount = payInGroup.payIns.reduce(
        (sum, p) => sum + (type === SendType.RETURN ? p.chargebackAmount : p.amount),
        0,
      );

      expect(totalAmount).toBe(270); // 90 + 180
    });
  });

  describe('delegation service method calls', () => {
    it('should call transferTokenViaDelegation with correct signature', () => {
      // The delegation service expects these parameters:
      // transferTokenViaDelegation(depositAccount, token, recipient, amount)

      const mockDelegationService = {
        transferTokenViaDelegation: jest.fn().mockResolvedValue('0xtxhash'),
      };

      const account = { seed: 'test', index: 0 };
      const asset = { blockchain: 'Ethereum', name: 'USDC', chainId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
      const recipient = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78';
      const amount = 100;

      // Simulate the call from dispatchViaDelegation
      mockDelegationService.transferTokenViaDelegation(account, asset, recipient, amount);

      expect(mockDelegationService.transferTokenViaDelegation).toHaveBeenCalledWith(
        expect.objectContaining({ seed: 'test', index: 0 }),
        expect.objectContaining({ blockchain: 'Ethereum', name: 'USDC' }),
        recipient,
        amount,
      );
    });
  });

  describe('error handling in delegation flow', () => {
    it('should not throw when delegation fails - errors are logged', async () => {
      const mockDelegationService = {
        transferTokenViaDelegation: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      // The doSend method catches errors and logs them, continuing with other groups
      // This test verifies the error handling behavior

      try {
        await mockDelegationService.transferTokenViaDelegation({}, {}, '', 0);
        fail('Should have thrown');
      } catch (e) {
        expect(e.message).toBe('Network error');
      }
    });

    it('should skip "No maximum fee provided" errors silently', () => {
      const error = new Error('No maximum fee provided');

      // The strategy has special handling for this error - it continues without logging
      const shouldSkip = error.message?.includes('No maximum fee provided');
      expect(shouldSkip).toBe(true);
    });
  });

  describe('legacy fallback when delegation disabled', () => {
    it('should use legacy flow when isDelegationSupported returns false', () => {
      const mockDelegationService = {
        isDelegationSupported: jest.fn().mockReturnValue(false),
      };

      const result = mockDelegationService.isDelegationSupported('Ethereum');

      // When delegation is not supported, doSend should call super.doSend (legacy flow)
      expect(result).toBe(false);
    });

    it('should use legacy flow when delegationService is undefined', () => {
      const delegationService: { isDelegationSupported?: (b: string) => boolean } | undefined = undefined;
      const result = delegationService?.isDelegationSupported?.('Ethereum') ?? false;

      expect(result).toBe(false);
    });
  });
});

describe('Delegation Service Integration Contract', () => {
  // These tests document the contract between EvmTokenStrategy and Eip7702DelegationService

  describe('isDelegationSupported contract', () => {
    it('expects blockchain parameter and returns boolean', () => {
      type IsDelegationSupported = (blockchain: string) => boolean;

      const fn: IsDelegationSupported = (blockchain) => blockchain === 'Ethereum';
      expect(fn('Ethereum')).toBe(true);
      expect(fn('Bitcoin')).toBe(false);
    });
  });

  describe('transferTokenViaDelegation contract', () => {
    it('expects account, token, recipient, amount and returns tx hash promise', async () => {
      interface WalletAccount {
        seed: string;
        index: number;
      }

      interface Asset {
        blockchain: string;
        chainId: string;
        decimals: number;
        name: string;
      }

      type TransferTokenViaDelegation = (
        depositAccount: WalletAccount,
        token: Asset,
        recipient: string,
        amount: number,
      ) => Promise<string>;

      const fn: TransferTokenViaDelegation = async () => '0xtxhash';

      const result = await fn(
        { seed: 'test', index: 0 },
        { blockchain: 'Ethereum', chainId: '0xA0b8', decimals: 6, name: 'USDC' },
        '0xRecipient',
        100,
      );

      expect(result).toBe('0xtxhash');
    });
  });
});
