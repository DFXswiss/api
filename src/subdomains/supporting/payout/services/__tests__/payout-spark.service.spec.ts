import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { SparkClient } from 'src/integration/blockchain/spark/spark-client';
import { PayoutSparkService } from '../payout-spark.service';
import { PayoutOrderContext } from '../../entities/payout-order.entity';

describe('PayoutSparkService', () => {
  let service: PayoutSparkService;
  let sparkService: SparkService;

  const mockSparkClient = createMock<SparkClient>();
  const mockSparkService = createMock<SparkService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutSparkService,
        {
          provide: SparkService,
          useValue: mockSparkService,
        },
      ],
    }).compile();

    service = module.get<PayoutSparkService>(PayoutSparkService);
    sparkService = module.get<SparkService>(SparkService);

    // Setup default mocks
    mockSparkService.getDefaultClient.mockReturnValue(mockSparkClient);
    mockSparkService.isHealthy.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isHealthy', () => {
    it('should return true when spark service is healthy', async () => {
      mockSparkService.isHealthy.mockResolvedValue(true);

      const result = await service.isHealthy();

      expect(result).toBe(true);
      expect(sparkService.isHealthy).toHaveBeenCalled();
    });

    it('should return false when spark service throws error', async () => {
      mockSparkService.isHealthy.mockRejectedValue(new Error('Connection failed'));

      const result = await service.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('sendUtxoToMany', () => {
    it('should send to multiple addresses with 0 fee rate', async () => {
      const payout = [
        { addressTo: 'sp1address1', amount: 100 },
        { addressTo: 'sp1address2', amount: 200 },
      ];
      mockSparkClient.sendMany.mockResolvedValue('txid123');

      const result = await service.sendUtxoToMany(PayoutOrderContext.MANUAL, payout);

      expect(result).toBe('txid123');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith(payout, 0);
    });
  });

  describe('getPayoutCompletionData', () => {
    it('should return true and 0 fee for confirmed transaction', async () => {
      mockSparkClient.getTransaction.mockResolvedValue({
        confirmations: 1,
        txid: 'txid123',
      });

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, 'txid123');

      expect(isComplete).toBe(true);
      expect(fee).toBe(0);
    });

    it('should return false and 0 fee for pending transaction', async () => {
      mockSparkClient.getTransaction.mockResolvedValue({
        confirmations: 0,
        txid: 'txid123',
      });

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, 'txid123');

      expect(isComplete).toBe(false);
      expect(fee).toBe(0);
    });

    it('should return false and 0 fee for transaction not found', async () => {
      mockSparkClient.getTransaction.mockResolvedValue(null);

      const [isComplete, fee] = await service.getPayoutCompletionData(PayoutOrderContext.MANUAL, 'txid123');

      expect(isComplete).toBe(false);
      expect(fee).toBe(0);
    });
  });

  describe('getCurrentFeeRate', () => {
    it('should always return 0', async () => {
      const result = await service.getCurrentFeeRate();

      expect(result).toBe(0);
    });
  });

  describe('getBatchSize', () => {
    it('should return 100 as batch size', () => {
      const batchSize = service.getBatchSize();

      expect(batchSize).toBe(100);
    });
  });
});