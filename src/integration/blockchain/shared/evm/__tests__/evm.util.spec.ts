import { Test } from '@nestjs/testing';
import { BigNumber } from 'ethers';
import { TestUtil } from 'src/shared/utils/test.util';
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
});
