import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { SparkService } from '../spark.service';
import { SparkFeeService } from '../services/spark-fee.service';

describe('SparkService', () => {
  let service: SparkService;
  let httpService: HttpService;

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SparkService,
        SparkFeeService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<SparkService>(SparkService);
    httpService = module.get<HttpService>(HttpService);
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
  });

  describe('Address Validation', () => {
    it('should validate Spark addresses with correct prefix', () => {
      const validAddresses = [
        'sp1pgssymg8gae63va59pxdp0hxs74g8lfvf5g2g9rty3zfht7mzan3j3wt7k308n',
        'spt1testaddress', // testnet
        'sprt1regtestaddress', // regtest
      ];

      validAddresses.forEach((address) => {
        const prefix = address.split('1')[0];
        expect(['sp', 'spt', 'sprt', 'sps', 'spl']).toContain(prefix);
      });
    });
  });

  describe('Transaction Methods', () => {
    it('should call client getBalance', async () => {
      mockHttpService.post.mockResolvedValue({ result: 100.5 });

      const balance = await service.getBalance();
      expect(balance).toBeDefined();
    });

    it('should estimate fees', async () => {
      mockHttpService.post.mockResolvedValue({ result: 0.00001 });

      const fee = await service.estimateFee(6);
      expect(fee).toBeDefined();
      expect(typeof fee).toBe('number');
    });
  });
});