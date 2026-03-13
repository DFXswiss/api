import { ArkService } from '../ark.service';

describe('ArkService', () => {
  let service: ArkService;

  beforeEach(() => {
    // ArkService constructor creates an ArkClient internally, which is mocked via moduleNameMapper
    service = new ArkService();
  });

  // --- PAYMENT REQUEST --- //

  describe('getPaymentRequest', () => {
    it('should return a correctly formatted ark: URI', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 0.001);

      expect(result).toBe('ark:ark1testaddress?amount=0.00100000');
    });

    it('should format amount with 8 decimal places', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 1);

      expect(result).toBe('ark:ark1testaddress?amount=1.00000000');
    });

    it('should handle very small amounts', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 0.00000001);

      expect(result).toBe('ark:ark1testaddress?amount=0.00000001');
    });
  });
});
