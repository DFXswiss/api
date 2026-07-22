import { Test } from '@nestjs/testing';
import { BigNumber } from 'ethers';
import { TestUtil } from 'src/shared/utils/test.util';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { EvmUtil } from '../evm.util';

describe('EvmUtil', () => {
  beforeAll(async () => {
    const config = {
      blockchain: {
        ethereum: { ethChainId: 1 },
        sepolia: { sepoliaChainId: 11155111 },
        arbitrum: { arbitrumChainId: 42161 },
        optimism: { optimismChainId: 10 },
        polygon: { polygonChainId: 137 },
        base: { baseChainId: 8453 },
        gnosis: { gnosisChainId: 100 },
        bsc: { bscChainId: 56 },
        citrea: { citreaChainId: 4114 },
        citreaTestnet: { citreaTestnetChainId: 5115 },
      },
    };

    await Test.createTestingModule({
      providers: [TestUtil.provideConfig(config)],
    }).compile();
  });

  describe('toWeiAmount', () => {
    it('should handle decimals=0 (REALU case)', () => {
      // REALU has 0 decimals - 100 tokens = 100 wei (no multiplication)
      const result = EvmUtil.toWeiAmount(100, 0);
      expect(result).toEqual(BigNumber.from('100'));
    });

    it('should handle decimals=undefined (native coin case)', () => {
      // ETH/native coins default to 18 decimals
      const result = EvmUtil.toWeiAmount(1);
      expect(result).toEqual(BigNumber.from('1000000000000000000'));
    });

    it('should handle decimals=18 (standard ERC20)', () => {
      const result = EvmUtil.toWeiAmount(1, 18);
      expect(result).toEqual(BigNumber.from('1000000000000000000'));
    });

    it('should handle decimals=6 (USDT/USDC case)', () => {
      const result = EvmUtil.toWeiAmount(100, 6);
      expect(result).toEqual(BigNumber.from('100000000'));
    });

    it('should handle fractional amounts with decimals=0', () => {
      // 0.5 with 0 decimals rounds to 1 (BigNumber.js rounds half up)
      const result = EvmUtil.toWeiAmount(0.5, 0);
      expect(result).toEqual(BigNumber.from('1'));
    });

    it('should handle large amounts with decimals=0', () => {
      const result = EvmUtil.toWeiAmount(1000000, 0);
      expect(result).toEqual(BigNumber.from('1000000'));
    });
  });

  describe('fromWeiAmount', () => {
    it('should handle decimals=0', () => {
      const result = EvmUtil.fromWeiAmount(BigNumber.from('100'), 0);
      expect(result).toBe(100);
    });

    it('should handle decimals=undefined (native coin)', () => {
      const result = EvmUtil.fromWeiAmount(BigNumber.from('1000000000000000000'));
      expect(result).toBe(1);
    });

    it('should handle decimals=6', () => {
      const result = EvmUtil.fromWeiAmount(BigNumber.from('100000000'), 6);
      expect(result).toBe(100);
    });
  });

  // #4287 stage 2: the broadcast-resolution base-unit capture used by the swap/bridge exact path.
  describe('toBroadcastBaseUnits (#4287 stage 2)', () => {
    it('preserves >8-dp precision for a token that the ≤8-dp float derivation would lose', () => {
      const asset = createCustomAsset({ type: AssetType.TOKEN, decimals: 18 });
      // 0.1234567891 has 10 dp — toBaseUnits caps at 8 dp; the broadcast capture keeps the full 18-dp wei
      expect(EvmUtil.toBroadcastBaseUnits(0.1234567891, asset)).toBe(123456789100000000n);
    });

    it('captures a native coin ONLY at 18 dp (matches parseEther)', () => {
      const coin = createCustomAsset({ type: AssetType.COIN, decimals: 18 });
      expect(EvmUtil.toBroadcastBaseUnits(0.1234567891, coin)).toBe(123456789100000000n);
    });

    it('fails open (null) for a coin whose configured decimals ≠ 18 (broadcast is parseEther/18)', () => {
      const coin = createCustomAsset({ type: AssetType.COIN, decimals: 8 });
      expect(EvmUtil.toBroadcastBaseUnits(1, coin)).toBeNull();
    });

    it('fails open (null) for unknown decimals or a missing asset', () => {
      expect(
        EvmUtil.toBroadcastBaseUnits(1, createCustomAsset({ type: AssetType.TOKEN, decimals: undefined })),
      ).toBeNull();
      expect(EvmUtil.toBroadcastBaseUnits(1, null)).toBeNull();
      expect(EvmUtil.toBroadcastBaseUnits(1, undefined)).toBeNull();
    });
  });

  // #4287 stage 2: the raw on-chain wei -> bigint capture used by the deposit/bridge-arrival exact path.
  describe('toBaseUnitsFromRaw (#4287 stage 2)', () => {
    it('normalises a hex wei string to exact base units', () => {
      expect(EvmUtil.toBaseUnitsFromRaw('0x0de0b6b3a7640000')).toBe(1000000000000000000n); // 1e18
    });

    it('preserves a full 18-dp decimal-integer string exactly', () => {
      expect(EvmUtil.toBaseUnitsFromRaw('123456789012345678')).toBe(123456789012345678n);
    });

    it('accepts a BigNumber', () => {
      expect(EvmUtil.toBaseUnitsFromRaw(BigNumber.from('42'))).toBe(42n);
    });

    it('fails open (null) on a malformed value', () => {
      expect(EvmUtil.toBaseUnitsFromRaw('not-a-number')).toBeNull();
    });
  });
});
