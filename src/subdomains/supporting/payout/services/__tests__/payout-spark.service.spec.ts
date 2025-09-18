import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { SparkFeeService } from 'src/integration/blockchain/spark/services/spark-fee.service';
import { SparkClient } from 'src/integration/blockchain/spark/spark-client';
import { PayoutSparkService } from '../payout-spark.service';
import { PayoutOrderContext } from '../../entities/payout-order.entity';

describe('PayoutSparkService', () => {
  let service: PayoutSparkService;
  let sparkService: SparkService;
  let feeService: SparkFeeService;
  let sparkClient: SparkClient;

  const mockSparkClient = createMock<SparkClient>();
  const mockSparkService = createMock<SparkService>();
  const mockFeeService = createMock<SparkFeeService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutSparkService,
        {
          provide: SparkService,
          useValue: mockSparkService,
        },
        {
          provide: SparkFeeService,
          useValue: mockFeeService,
        },
      ],
    }).compile();

    service = module.get<PayoutSparkService>(PayoutSparkService);
    sparkService = module.get<SparkService>(SparkService);
    feeService = module.get<SparkFeeService>(SparkFeeService);

    // Setup default mocks
    mockSparkService.getDefaultClient.mockReturnValue(mockSparkClient);
    mockSparkService.isHealthy.mockResolvedValue(true);
    mockFeeService.getRecommendedFeeRate.mockResolvedValue(0); // SPARK has no fees
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isHealthy', () => {
    it('should return true when spark service is healthy', async () => {
      const result = await service.isHealthy();
      expect(result).toBe(true);
      expect(sparkService.isHealthy).toHaveBeenCalled();
    });

    it('should return false when spark service is not healthy', async () => {
      mockSparkService.isHealthy.mockResolvedValue(false);
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });

  describe('sendUtxoToMany', () => {
    it('should send to multiple addresses successfully', async () => {
      const context = PayoutOrderContext.MANUAL;
      // PayoutGroup is an array of { addressTo, amount }
      const payout = [
        { addressTo: 'sp1address1', amount: 0.5 },
        { addressTo: 'sp1address2', amount: 1.0 },
        { addressTo: 'sp1address3', amount: 0.25 },
      ];

      mockSparkClient.sendMany.mockResolvedValue('txid123');

      const result = await service.sendUtxoToMany(context, payout);

      expect(result).toBe('txid123');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith([
        { addressTo: 'sp1address1', amount: 0.5 },
        { addressTo: 'sp1address2', amount: 1.0 },
        { addressTo: 'sp1address3', amount: 0.25 },
      ], 0); // SPARK has no fees
    });

    it('should handle single address payout', async () => {
      const context = PayoutOrderContext.MANUAL;
      const payout = [{ addressTo: 'sp1singleaddress', amount: 1 }];

      mockSparkClient.sendMany.mockResolvedValue('txid456');

      const result = await service.sendUtxoToMany(context, payout);

      expect(result).toBe('txid456');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith(
        [{ addressTo: 'sp1singleaddress', amount: 1 }],
        0, // SPARK has no fees
      );
    });

    it('should handle multiple outputs in single transaction', async () => {
      const context = PayoutOrderContext.MANUAL;
      const payout = [
        { addressTo: 'sp1address1', amount: 123.456789 },
        { addressTo: 'sp1address2', amount: 0.001 },
        { addressTo: 'sp1address3', amount: 50 },
      ];

      mockSparkClient.sendMany.mockResolvedValue('txid789');

      const result = await service.sendUtxoToMany(context, payout);

      expect(result).toBe('txid789');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith(
        payout,
        0,
      );
    });
  });

  describe('getPayoutCompletionData', () => {
    it('should return completion status and fee for confirmed transaction', async () => {
      const txId = 'txid123';
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: txId,
        blockhash: 'confirmed',
        confirmations: 1, // SPARK uses binary confirmation: 1 = confirmed
        fee: 0, // SPARK has no fees
      });

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, txId);

      expect(isComplete).toBe(true);
      expect(fee).toBe(0); // SPARK has no fees
    });

    it('should return incomplete status for unconfirmed transaction', async () => {
      const txId = 'txid123';
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: txId,
        confirmations: 0,
      });

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, txId);

      expect(isComplete).toBe(false);
      expect(fee).toBe(0);
    });
  });

  describe('getCurrentFeeRate', () => {
    it('should return 0 for SPARK fee rate', async () => {
      const rate = await service.getCurrentFeeRate();

      expect(rate).toBe(0); // SPARK has no fees
    });
  });

  describe('estimateFee', () => {
    it('should return 0 fee for SPARK transactions', async () => {
      const fee = await service.estimateFee(10);

      expect(fee).toBe(0); // SPARK has no fees
    });
  });

  describe('validateAddress', () => {
    it('should validate address through spark service', async () => {
      mockSparkService.validateAddress.mockResolvedValue(true);

      const result = await service.validateAddress('sp1validaddress');

      expect(result).toBe(true);
      expect(sparkService.validateAddress).toHaveBeenCalledWith('sp1validaddress');
    });

    it('should reject invalid address', async () => {
      mockSparkService.validateAddress.mockResolvedValue(false);

      const result = await service.validateAddress('invalid');

      expect(result).toBe(false);
      expect(sparkService.validateAddress).toHaveBeenCalledWith('invalid');
    });
  });

  describe('getBalance', () => {
    it('should get balance through spark service', async () => {
      mockSparkService.getBalance.mockResolvedValue(10.5);

      const balance = await service.getBalance('sp1address');

      expect(balance).toBe(10.5);
      expect(sparkService.getBalance).toHaveBeenCalledWith('sp1address');
    });

    it('should get balance without address', async () => {
      mockSparkService.getBalance.mockResolvedValue(100.25);

      const balance = await service.getBalance();

      expect(balance).toBe(100.25);
      expect(sparkService.getBalance).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getConfirmationCount', () => {
    it('should return 1 for confirmed transaction', async () => {
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: 'txid',
        confirmations: 1, // SPARK: 1 = confirmed
      });

      const count = await service.getConfirmationCount('txid');

      expect(count).toBe(1);
    });

    it('should return 0 for pending transaction', async () => {
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: 'txid',
        confirmations: 0, // SPARK: 0 = pending
      });

      const count = await service.getConfirmationCount('txid');

      expect(count).toBe(0);
    });

    it('should return 0 for non-existent transaction', async () => {
      mockSparkClient.getTransaction.mockRejectedValue(new Error('Not found'));

      const count = await service.getConfirmationCount('invalid');

      expect(count).toBe(0);
    });
  });

  describe('getBatchSize', () => {
    it('should return correct batch size limit', () => {
      const batchSize = service.getBatchSize();
      expect(batchSize).toBe(100);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty payout gracefully', async () => {
      const context = PayoutOrderContext.MANUAL;
      const payout = []; // Empty payout array

      mockSparkClient.sendMany.mockResolvedValue('empty-tx');

      const result = await service.sendUtxoToMany(context, payout);

      expect(result).toBe('empty-tx');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith([], 0);
    });

    it('should handle transaction not found in getPayoutCompletionData', async () => {
      mockSparkClient.getTransaction.mockResolvedValue(null);

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, 'unknown-tx');

      expect(isComplete).toBe(false);
      expect(fee).toBe(0);
    });

    it('should handle error in getConfirmationCount', async () => {
      mockSparkClient.getTransaction.mockRejectedValue(new Error('Network error'));

      const count = await service.getConfirmationCount('error-tx');

      expect(count).toBe(0);
    });
  });
});