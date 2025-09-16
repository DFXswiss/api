import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { SparkService, SparkNodeType } from 'src/integration/blockchain/spark/spark.service';
import { SparkFeeService, SparkFeeTarget } from 'src/integration/blockchain/spark/services/spark-fee.service';
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
    mockFeeService.getRecommendedFeeRate.mockResolvedValue(15);
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
    it('should send multiple UTXOs successfully', async () => {
      const context = PayoutOrderContext.MANUAL;
      const payout = {
        'sp1address1': 0.5,
        'sp1address2': 1.0,
        'sp1address3': 0.25,
      };

      mockSparkClient.sendMany.mockResolvedValue('txid123');

      const result = await service.sendUtxoToMany(context, payout);

      expect(result).toBe('txid123');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith([
        { addressTo: 'sp1address1', amount: 0.5 },
        { addressTo: 'sp1address2', amount: 1.0 },
        { addressTo: 'sp1address3', amount: 0.25 },
      ], expect.any(Number));
    });

    it('should apply 1.5x fee multiplier', async () => {
      const context = PayoutOrderContext.MANUAL;
      const payout = { 'sp1address': 1 };

      mockFeeService.getRecommendedFeeRate.mockResolvedValue(10);
      mockSparkClient.sendMany.mockResolvedValue('txid');

      await service.sendUtxoToMany(context, payout);

      expect(mockSparkClient.sendMany).toHaveBeenCalledWith(
        expect.any(Array),
        15, // 10 * 1.5
      );
    });
  });

  describe('getPayoutCompletionData', () => {
    it('should return completion status and fee for confirmed transaction', async () => {
      const txId = 'txid123';
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: txId,
        blockhash: 'blockhash123',
        confirmations: 3,
        fee: -0.0001,
      });

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, txId);

      expect(isComplete).toBe(true);
      expect(fee).toBe(0.0001);
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
    it('should get fee rate with 1.5x multiplier', async () => {
      mockFeeService.getRecommendedFeeRate.mockResolvedValue(20);

      const rate = await service.getCurrentFeeRate();

      expect(rate).toBe(30); // 20 * 1.5
      expect(feeService.getRecommendedFeeRate).toHaveBeenCalledWith(SparkFeeTarget.NORMAL);
    });
  });

  describe('estimateFee', () => {
    it('should estimate fee for batch transaction', async () => {
      mockFeeService.estimateBatchTransactionFee.mockResolvedValue({
        fee: 0.0002,
        feeRate: 15,
        size: 1000,
      });

      const fee = await service.estimateFee(10);

      expect(fee).toBe(0.0002);
      expect(feeService.estimateBatchTransactionFee).toHaveBeenCalledWith(10, SparkFeeTarget.NORMAL);
    });
  });

  describe('validateAddress', () => {
    it('should validate address through spark service', async () => {
      mockSparkService.validateAddress.mockResolvedValue(true);

      const result = await service.validateAddress('sp1validaddress');

      expect(result).toBe(true);
      expect(sparkService.validateAddress).toHaveBeenCalledWith('sp1validaddress');
    });
  });

  describe('getBalance', () => {
    it('should get balance through spark service', async () => {
      mockSparkService.getBalance.mockResolvedValue(10.5);

      const balance = await service.getBalance('sp1address');

      expect(balance).toBe(10.5);
      expect(sparkService.getBalance).toHaveBeenCalledWith('sp1address');
    });
  });

  describe('getConfirmationCount', () => {
    it('should return confirmation count for transaction', async () => {
      mockSparkClient.getTransaction.mockResolvedValue({
        txid: 'txid',
        confirmations: 6,
      });

      const count = await service.getConfirmationCount('txid');

      expect(count).toBe(6);
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
});