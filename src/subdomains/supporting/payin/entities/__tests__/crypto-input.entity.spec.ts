import { createCustomCryptoInput } from '../__mocks__/crypto-input.entity.mock';
import { PayInStatus } from '../crypto-input.entity';

describe('CryptoInput', () => {
  describe('#fail(...)', () => {
    it('sets status to PayInStatus.FAILED', () => {
      const entity = createCustomCryptoInput({ id: 1, status: PayInStatus.ACKNOWLEDGED });

      const [id, update] = entity.fail();

      expect(id).toBe(1);
      expect(update).toEqual({ status: PayInStatus.FAILED });
      expect(entity.status).toBe(PayInStatus.FAILED);
    });
  });
});
