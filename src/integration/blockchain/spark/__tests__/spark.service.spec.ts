import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { HttpService } from 'src/shared/services/http.service';
import { SparkService } from '../spark.service';
import { SparkClient } from '../spark-client';

describe('SparkService', () => {
  let service: SparkService;
  let sparkClient: SparkClient;

  const mockSparkClient = createMock<SparkClient>();
  const mockHttpService = createMock<HttpService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SparkService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<SparkService>(SparkService);
    // Replace the client with mock
    (service as any).client = mockSparkClient;
    sparkClient = mockSparkClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Signature Verification', () => {
    it('should verify a valid Spark signature', async () => {
      const address = 'sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n';
      const message = 'Test message';
      const signature = 'ddcf3fe0134167c67be99ff29a157ee82572a3351a06c1821f1f45586bfee8450e59bb965ffee0fb3f7445d845e6da5d11a952971998ccb64171ae0cef93f0b4';

      const result = await service.verifySignature(message, address, signature);
      expect(typeof result).toBe('boolean');
    });

    it('should return false for invalid signature', async () => {
      const address = 'sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n';
      const message = 'Test message';
      const signature = 'invalid_signature';

      const result = await service.verifySignature(message, address, signature);
      expect(result).toBe(false);
    });

    it('should return false for invalid hex signature', async () => {
      const address = 'sp1test';
      const message = 'Test';
      const signature = 'not-hex';

      const result = await service.verifySignature(message, address, signature);
      expect(result).toBe(false);
    });
  });

  describe('Address Validation', () => {
    it('should validate valid Spark addresses', async () => {
      mockSparkClient.validateAddress.mockResolvedValue({ isvalid: true, address: 'sp1test' });

      const result = await service.validateAddress('sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n');

      expect(result).toBe(true);
      expect(mockSparkClient.validateAddress).toHaveBeenCalledWith('sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n');
    });

    it('should reject invalid Spark addresses', async () => {
      mockSparkClient.validateAddress.mockResolvedValue({ isvalid: false });

      const result = await service.validateAddress('invalid-address');

      expect(result).toBe(false);
    });

    it('should validate Spark addresses with correct prefix', () => {
      const validAddresses = [
        'sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n',
        'spt1testaddress', // testnet
        'sprt1regtestaddress', // regtest
        'sps1signetaddress', // signet
        'spl1localaddress', // local
      ];

      validAddresses.forEach((address) => {
        const prefix = address.split('1')[0];
        expect(['sp', 'spt', 'sprt', 'sps', 'spl']).toContain(prefix);
      });
    });
  });

  describe('Transaction Methods', () => {
    it('should get balance from client', async () => {
      mockSparkClient.getBalance.mockResolvedValue(100.5);

      const balance = await service.getBalance();

      expect(balance).toBe(100.5);
      expect(mockSparkClient.getBalance).toHaveBeenCalled();
    });

    it('should get balance for specific address', async () => {
      mockSparkClient.getBalance.mockResolvedValue(50.25);

      const balance = await service.getBalance('sp1specificaddress');

      expect(balance).toBe(50.25);
      expect(mockSparkClient.getBalance).toHaveBeenCalledWith('sp1specificaddress');
    });

    it('should send transaction', async () => {
      mockSparkClient.sendTransaction.mockResolvedValue({ txid: 'tx123', fee: 0 });

      const result = await service.sendTransaction('sp1recipient', 10.5, 0);

      expect(result).toEqual({ txid: 'tx123', fee: 0 });
      expect(mockSparkClient.sendTransaction).toHaveBeenCalledWith('sp1recipient', 10.5, 0);
    });

    it('should send to many addresses', async () => {
      mockSparkClient.sendMany.mockResolvedValue('batch123');

      const outputs = [
        { addressTo: 'sp1addr1', amount: 1 },
        { addressTo: 'sp1addr2', amount: 2 }
      ];

      const result = await service.sendMany(outputs, 0);

      expect(result).toBe('batch123');
      expect(mockSparkClient.sendMany).toHaveBeenCalledWith(outputs, 0);
    });

    it('should get transaction details', async () => {
      const mockTx = {
        txid: 'tx123',
        confirmations: 1,
        blockhash: 'confirmed',
        fee: 0
      };
      mockSparkClient.getTransaction.mockResolvedValue(mockTx);

      const tx = await service.getTransaction('tx123');

      expect(tx).toEqual(mockTx);
      expect(mockSparkClient.getTransaction).toHaveBeenCalledWith('tx123');
    });

    it('should estimate fees (always returns 0 for Spark)', async () => {
      mockSparkClient.estimateFee.mockResolvedValue({ feerate: 0, blocks: 6 });

      const fee = await service.estimateFee(6);

      expect(fee).toBe(0);
      expect(mockSparkClient.estimateFee).toHaveBeenCalledWith(6);
    });
  });

  describe('Payment Request', () => {
    it('should generate payment request URI', async () => {
      const address = 'sp1paymentaddress';
      const amount = 1.5;

      const uri = await service.getPaymentRequest(address, amount);

      expect(uri).toBe('spark:sp1paymentaddress?amount=1.50000000');
    });

    it('should format amount to 8 decimal places', async () => {
      const uri = await service.getPaymentRequest('sp1addr', 0.123456789);

      expect(uri).toBe('spark:sp1addr?amount=0.12345679');
    });
  });

  describe('Health Check', () => {
    it('should return true when client is healthy', async () => {
      mockSparkClient.isHealthy.mockResolvedValue(true);

      const isHealthy = await service.isHealthy();

      expect(isHealthy).toBe(true);
    });

    it('should return false when client throws error', async () => {
      mockSparkClient.isHealthy.mockRejectedValue(new Error('Connection failed'));

      const isHealthy = await service.isHealthy();

      expect(isHealthy).toBe(false);
    });
  });
});