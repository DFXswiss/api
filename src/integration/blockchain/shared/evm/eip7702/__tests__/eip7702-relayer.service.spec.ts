import { BigNumber } from 'ethers';

// Mock GetConfig before importing the service
const mockConfig = {
  blockchain: {
    ethereum: {
      ethGatewayUrl: 'https://eth-mainnet.test.com/v2',
      ethApiKey: 'test-api-key',
      ethChainId: 1,
      ethWalletPrivateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    },
    gasless: {
      delegationContractAddress: '0xDelegationContract1234567890123456789012',
      allowedRecipients: ['0xAllowedRecipient123456789012345678901234', '0xAnotherRecipient12345678901234567890123'],
      relayerPrivateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    },
  },
};

jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => mockConfig),
}));

// Mock ethers
const mockNonce = jest.fn();
const mockExecuteTransfer = jest.fn();
const mockWait = jest.fn();
const mockGetGasPrice = jest.fn();
const mockGetTransferHash = jest.fn();
const mockDomainSeparator = jest.fn();

jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  return {
    ...originalModule,
    ethers: {
      ...originalModule.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
          getGasPrice: mockGetGasPrice,
        })),
      },
      Wallet: jest.fn().mockImplementation(() => ({})),
    },
    Contract: jest.fn().mockImplementation(() => ({
      nonce: mockNonce,
      executeTransfer: mockExecuteTransfer,
      getTransferHash: mockGetTransferHash,
      DOMAIN_SEPARATOR: mockDomainSeparator,
    })),
  };
});

import { Eip7702RelayerService } from '../eip7702-relayer.service';

describe('Eip7702RelayerService', () => {
  let service: Eip7702RelayerService;

  const userAddress = '0xUser1234567890123456789012345678901234';
  const tokenAddress = '0xToken123456789012345678901234567890123';
  const allowedRecipient = '0xAllowedRecipient123456789012345678901234';
  const disallowedRecipient = '0xDisallowedRecipient12345678901234567890';
  const amount = '1000000000000000000'; // 1 token in wei

  beforeEach(() => {
    jest.clearAllMocks();
    mockNonce.mockResolvedValue(BigNumber.from(0));
    mockGetGasPrice.mockResolvedValue(BigNumber.from('20000000000')); // 20 gwei
    service = new Eip7702RelayerService();
  });

  describe('constructor', () => {
    it('should initialize with config values', () => {
      expect(service.getDelegationContractAddress()).toBe(mockConfig.blockchain.gasless.delegationContractAddress);
      expect(service.getChainId()).toBe(mockConfig.blockchain.ethereum.ethChainId);
    });
  });

  describe('isRecipientAllowed', () => {
    it('should return true for allowed recipient', () => {
      expect(service.isRecipientAllowed(allowedRecipient)).toBe(true);
    });

    it('should return true for allowed recipient (case insensitive)', () => {
      expect(service.isRecipientAllowed(allowedRecipient.toUpperCase())).toBe(true);
    });

    it('should return false for disallowed recipient', () => {
      expect(service.isRecipientAllowed(disallowedRecipient)).toBe(false);
    });
  });

  describe('validateRecipient', () => {
    it('should not throw for allowed recipient', () => {
      expect(() => service.validateRecipient(allowedRecipient)).not.toThrow();
    });

    it('should throw for disallowed recipient', () => {
      expect(() => service.validateRecipient(disallowedRecipient)).toThrow(
        `Recipient ${disallowedRecipient} is not in the allowed list`,
      );
    });
  });

  describe('getUserNonce', () => {
    it('should return nonce from contract', async () => {
      mockNonce.mockResolvedValue(BigNumber.from(5));

      const nonce = await service.getUserNonce(userAddress);

      expect(nonce).toBe(5);
    });

    it('should return 0 if contract call fails (no delegation yet)', async () => {
      mockNonce.mockRejectedValue(new Error('Contract not found'));

      const nonce = await service.getUserNonce(userAddress);

      expect(nonce).toBe(0);
    });
  });

  describe('prepareGaslessTransfer', () => {
    it('should prepare transfer data with correct EIP-712 structure', async () => {
      mockNonce.mockResolvedValue(BigNumber.from(3));

      const result = await service.prepareGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadlineMinutes: 30,
      });

      expect(result.nonce).toBe(3);
      expect(result.delegationContract).toBe(mockConfig.blockchain.gasless.delegationContractAddress);
      expect(result.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(result.deadline).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 30 * 60 + 1);

      // Verify EIP-712 structure
      expect(result.eip712Data.primaryType).toBe('Transfer');
      expect(result.eip712Data.domain.name).toBe('DfxGaslessSell');
      expect(result.eip712Data.domain.version).toBe('1');
      expect(result.eip712Data.domain.chainId).toBe(1);
      expect(result.eip712Data.domain.verifyingContract).toBe(userAddress);
      expect(result.eip712Data.message.token).toBe(tokenAddress);
      expect(result.eip712Data.message.amount).toBe(amount);
      expect(result.eip712Data.message.recipient).toBe(allowedRecipient);
      expect(result.eip712Data.message.nonce).toBe(3);
    });

    it('should use default deadline of 60 minutes if not specified', async () => {
      mockNonce.mockResolvedValue(BigNumber.from(0));

      const beforeTime = Math.floor(Date.now() / 1000);
      const result = await service.prepareGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
      });
      const afterTime = Math.floor(Date.now() / 1000);

      // Deadline should be ~60 minutes from now
      expect(result.deadline).toBeGreaterThanOrEqual(beforeTime + 60 * 60);
      expect(result.deadline).toBeLessThanOrEqual(afterTime + 60 * 60 + 1);
    });

    it('should throw for disallowed recipient', async () => {
      await expect(
        service.prepareGaslessTransfer({
          userAddress,
          tokenAddress,
          amount,
          recipient: disallowedRecipient,
        }),
      ).rejects.toThrow(`Recipient ${disallowedRecipient} is not in the allowed list`);
    });

    it('should include correct EIP-712 types', async () => {
      mockNonce.mockResolvedValue(BigNumber.from(0));

      const result = await service.prepareGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
      });

      expect(result.eip712Data.types.EIP712Domain).toEqual([
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ]);

      expect(result.eip712Data.types.Transfer).toEqual([
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ]);
    });
  });

  describe('executeGaslessTransfer', () => {
    const validSignature = {
      v: 27,
      r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    };

    it('should execute transfer successfully', async () => {
      const txHash = '0xTransactionHash12345678901234567890123456789012345678901234';
      mockExecuteTransfer.mockResolvedValue({
        wait: mockWait.mockResolvedValue({
          status: 1,
          transactionHash: txHash,
        }),
      });

      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const result = await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadline,
        signature: validSignature,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(txHash);
      expect(result.error).toBeUndefined();
    });

    it('should return error for expired deadline', async () => {
      const deadline = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      const result = await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadline,
        signature: validSignature,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Deadline has passed');
    });

    it('should return error for disallowed recipient', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const result = await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: disallowedRecipient,
        deadline,
        signature: validSignature,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('is not in the allowed list');
    });

    it('should return error when transaction fails', async () => {
      mockExecuteTransfer.mockRejectedValue(new Error('Transaction reverted'));

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const result = await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadline,
        signature: validSignature,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction reverted');
    });

    it('should return error when transaction receipt status is 0', async () => {
      mockExecuteTransfer.mockResolvedValue({
        wait: mockWait.mockResolvedValue({
          status: 0, // Failed
          transactionHash: '0xFailedTx',
        }),
      });

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const result = await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadline,
        signature: validSignature,
      });

      expect(result.success).toBe(false);
    });

    it('should apply 20% gas price buffer', async () => {
      mockExecuteTransfer.mockResolvedValue({
        wait: mockWait.mockResolvedValue({
          status: 1,
          transactionHash: '0xTxHash',
        }),
      });

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await service.executeGaslessTransfer({
        userAddress,
        tokenAddress,
        amount,
        recipient: allowedRecipient,
        deadline,
        signature: validSignature,
      });

      // Gas price should be 20 gwei * 1.2 = 24 gwei
      expect(mockExecuteTransfer).toHaveBeenCalledWith(
        tokenAddress,
        amount,
        allowedRecipient,
        deadline,
        validSignature.v,
        validSignature.r,
        validSignature.s,
        expect.objectContaining({
          gasPrice: BigNumber.from('20000000000').mul(120).div(100),
        }),
      );
    });
  });

  describe('getTransferHash', () => {
    it('should call contract getTransferHash', async () => {
      const expectedHash = '0xTransferHash123456789012345678901234567890123456789012345678901234';
      mockGetTransferHash.mockResolvedValue(expectedHash);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const hash = await service.getTransferHash(userAddress, tokenAddress, amount, allowedRecipient, deadline);

      expect(hash).toBe(expectedHash);
      expect(mockGetTransferHash).toHaveBeenCalledWith(tokenAddress, amount, allowedRecipient, deadline);
    });
  });

  describe('getDomainSeparator', () => {
    it('should call contract DOMAIN_SEPARATOR', async () => {
      const expectedSeparator = '0xDomainSeparator1234567890123456789012345678901234567890123456';
      mockDomainSeparator.mockResolvedValue(expectedSeparator);

      const separator = await service.getDomainSeparator(userAddress);

      expect(separator).toBe(expectedSeparator);
    });
  });

  describe('getters', () => {
    it('getDelegationContractAddress should return configured address', () => {
      expect(service.getDelegationContractAddress()).toBe(mockConfig.blockchain.gasless.delegationContractAddress);
    });

    it('getChainId should return configured chain ID', () => {
      expect(service.getChainId()).toBe(1);
    });
  });
});
