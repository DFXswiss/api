import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { SparkClient } from '../spark-client';

// Mock Config before importing it
jest.mock('src/config/config', () => ({
  Config: {
    blockchain: {
      spark: {
        network: 'testnet'
      }
    }
  }
}));

// Mock the Spark SDK
jest.mock('@buildonspark/spark-sdk', () => ({
  SparkWallet: {
    initialize: jest.fn(),
  },
  isValidSparkAddress: jest.fn(),
}));

describe('SparkClient', () => {
  let client: SparkClient;
  let httpService: HttpService;

  const mockWallet = {
    getSparkAddress: jest.fn(),
    getBalance: jest.fn(),
    transfer: jest.fn(),
    getTransfer: jest.fn(),
  };

  beforeEach(async () => {
    // Reset environment
    process.env.SPARK_WALLET_SEED = 'test-seed-12345';

    // Mock SDK initialization BEFORE creating the module
    const { SparkWallet } = require('@buildonspark/spark-sdk');
    mockWallet.getSparkAddress.mockResolvedValue('sp1testaddress123');
    SparkWallet.initialize.mockResolvedValue({ wallet: mockWallet });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SparkClient,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    httpService = module.get<HttpService>(HttpService);
    client = module.get<SparkClient>(SparkClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Wallet Initialization', () => {
    it('should initialize wallet with seed from environment', async () => {
      const { SparkWallet } = require('@buildonspark/spark-sdk');

      // Trigger initialization by accessing wallet
      await (client as any).ensureWallet();

      expect(SparkWallet.initialize).toHaveBeenCalledWith({
        mnemonicOrSeed: 'test-seed-12345',
        accountNumber: 0,
        options: {
          network: 'TESTNET',
        },
      });
    });

    it('should cache wallet address after initialization', async () => {
      mockWallet.getSparkAddress.mockResolvedValue('sp1testaddress123');

      await (client as any).ensureWallet();

      const address = client.walletAddress;
      expect(address).toBe('sp1testaddress123');
    });

    it('should throw error if SPARK_WALLET_SEED is not set', async () => {
      delete process.env.SPARK_WALLET_SEED;

      const newClient = new SparkClient(httpService);

      await expect((newClient as any).initializeWallet()).rejects.toThrow(
        'SPARK_WALLET_SEED environment variable is required'
      );
    });
  });

  describe('Balance Methods', () => {
    beforeEach(async () => {
      await (client as any).ensureWallet();
    });

    it('should get balance from SDK wallet', async () => {
      mockWallet.getBalance.mockResolvedValue({
        balance: BigInt(150000000), // 1.5 BTC in satoshis
        tokenBalances: [],
      });

      const balance = await client.getBalance();

      expect(balance).toBe(1.5);
      expect(mockWallet.getBalance).toHaveBeenCalled();
    });

    it('should get wallet balance', async () => {
      mockWallet.getBalance.mockResolvedValue({
        balance: BigInt(250000000), // 2.5 BTC
        tokenBalances: [],
      });

      const balance = await client.getBalance();

      expect(balance).toBe(2.5);
    });
  });

  describe('Transaction Methods', () => {
    beforeEach(async () => {
      await (client as any).ensureWallet();
    });

    it('should send transaction using SDK', async () => {
      mockWallet.transfer.mockResolvedValue({ id: 'tx123' });

      const result = await client.sendTransaction('sp1recipient', 1.5, 0);

      expect(result).toEqual({ txid: 'tx123', fee: 0 });
      expect(mockWallet.transfer).toHaveBeenCalledWith({
        amountSats: 150000000,
        receiverSparkAddress: 'sp1recipient',
      });
    });

    it('should send to multiple addresses', async () => {
      mockWallet.transfer
        .mockResolvedValueOnce({ id: 'tx1' })
        .mockResolvedValueOnce({ id: 'tx2' })
        .mockResolvedValueOnce({ id: 'tx3' });

      const outputs = [
        { addressTo: 'sp1addr1', amount: 0.5 },
        { addressTo: 'sp1addr2', amount: 1.0 },
        { addressTo: 'sp1addr3', amount: 0.25 },
      ];

      const result = await client.sendMany(outputs, 0);

      expect(result).toBe('tx1,tx2,tx3');
      expect(mockWallet.transfer).toHaveBeenCalledTimes(3);
      expect(mockWallet.transfer).toHaveBeenCalledWith({
        amountSats: 50000000,
        receiverSparkAddress: 'sp1addr1',
      });
    });

    it('should get transaction details', async () => {
      mockWallet.getTransfer.mockResolvedValue({
        id: 'tx123',
        status: 'TRANSFER_STATUS_COMPLETED',
        createdTime: new Date('2024-01-01T00:00:00Z'),
        updatedTime: new Date('2024-01-01T00:01:00Z'),
      });

      const tx = await client.getTransaction('tx123');

      expect(tx).toEqual({
        txid: 'tx123',
        blockhash: 'confirmed',
        confirmations: 1,
        time: 1704067200,
        blocktime: 1704067260,
        fee: 0,
      });
    });

    it('should handle pending transaction', async () => {
      mockWallet.getTransfer.mockResolvedValue({
        id: 'tx456',
        status: 'TRANSFER_STATUS_PENDING',
      });

      const tx = await client.getTransaction('tx456');

      expect(tx.confirmations).toBe(0);
      expect(tx.blockhash).toBeUndefined();
    });

    it('should throw error for non-existent transaction', async () => {
      mockWallet.getTransfer.mockResolvedValue(null);

      await expect(client.getTransaction('unknown')).rejects.toThrow(
        'Transaction unknown not found'
      );
    });
  });

  describe('Address Validation', () => {
    it('should validate Spark address using SDK', async () => {
      const { isValidSparkAddress } = require('@buildonspark/spark-sdk');
      isValidSparkAddress.mockReturnValue(true);

      const result = await client.validateAddress('sp1validaddress');

      expect(result).toEqual({ isvalid: true, address: 'sp1validaddress' });
      expect(isValidSparkAddress).toHaveBeenCalledWith('sp1validaddress');
    });

    it('should reject invalid address', async () => {
      const { isValidSparkAddress } = require('@buildonspark/spark-sdk');
      isValidSparkAddress.mockReturnValue(false);

      const result = await client.validateAddress('invalid');

      expect(result).toEqual({ isvalid: false });
    });

    it('should handle SDK validation errors', async () => {
      const { isValidSparkAddress } = require('@buildonspark/spark-sdk');
      isValidSparkAddress.mockImplementation(() => {
        throw new Error('Invalid format');
      });

      const result = await client.validateAddress('bad-format');

      expect(result).toEqual({ isvalid: false });
    });
  });

  describe('Fee Methods', () => {
    it('should always return 0 for fee estimates', async () => {
      const estimate = await client.estimateFee(6);

      expect(estimate).toEqual({ feerate: 0, blocks: 6 });
    });

    it('should always return 0 for network fee rate', async () => {
      const rate = await client.getNetworkFeeRate();

      expect(rate).toBe(0);
    });
  });

  describe('Health and Status', () => {
    beforeEach(async () => {
      await (client as any).ensureWallet();
    });

    it('should return true if wallet is initialized', async () => {
      const isHealthy = await client.isHealthy();

      expect(isHealthy).toBe(true);
    });

    it('should return false if wallet initialization fails', async () => {
      const newClient = new SparkClient(httpService);
      // Force wallet to be null and mock ensureWallet to throw
      (newClient as any).wallet = null;
      (newClient as any).ensureWallet = jest.fn().mockRejectedValue(new Error('Wallet not initialized'));

      const isHealthy = await newClient.isHealthy();

      expect(isHealthy).toBe(false);
    });

    it('should consider wallet synced if initialized', async () => {
      const isSynced = await client.isSynced();

      expect(isSynced).toBe(true);
    });
  });

  describe('Network Info', () => {
    beforeEach(async () => {
      await (client as any).ensureWallet();
    });

    it('should return basic network info', async () => {
      const info = await client.getInfo();

      expect(info).toEqual({
        version: '1.0.0',
        testnet: true,
        connections: 1,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle wallet not initialized errors', async () => {
      const newClient = new SparkClient(httpService);
      // Mock ensureWallet to throw the expected error
      (newClient as any).ensureWallet = jest.fn().mockRejectedValue(new Error('SparkWallet not initialized'));

      await expect(newClient.getBalance()).rejects.toThrow('SparkWallet not initialized');
    });

    it('should handle SDK transfer errors', async () => {
      await (client as any).ensureWallet();
      mockWallet.transfer.mockRejectedValue(new Error('Insufficient funds'));

      await expect(client.sendTransaction('sp1addr', 1000, 0)).rejects.toThrow(
        'Insufficient funds'
      );
    });
  });

  describe('Interface Compliance', () => {
    it('should throw for unsupported raw transaction methods', async () => {
      await expect(client.sendSignedTransaction()).rejects.toThrow('Use SDK transfer methods');
    });

    it('should return 0 or empty for token-related methods', async () => {
      expect(await client.getTokenBalance()).toBe(0);
      expect(await client.getTokenBalances()).toEqual([]);
      expect(await client.getToken()).toBe(null);
    });

    it('should confirm transactions based on binary status', async () => {
      await (client as any).ensureWallet();

      mockWallet.getTransfer.mockResolvedValue({
        id: 'tx123',
        status: 'TRANSFER_STATUS_COMPLETED',
      });

      const isComplete = await client.isTxComplete('tx123', 1);

      expect(isComplete).toBe(true);
    });

    it('should handle transaction completion check for pending tx', async () => {
      await (client as any).ensureWallet();

      mockWallet.getTransfer.mockResolvedValue({
        id: 'tx456',
        status: 'TRANSFER_STATUS_PENDING',
      });

      const isComplete = await client.isTxComplete('tx456', 1);

      expect(isComplete).toBe(false);
    });
  });
});