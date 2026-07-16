import { createCustomCryptoInput } from '../__mocks__/crypto-input.entity.mock';
import { PayInStatus } from '../crypto-input.entity';

describe('CryptoInput', () => {
  describe('#designateSending(...)', () => {
    it('sets status to PayInStatus.SENDING', () => {
      const entity = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });

      const result = entity.designateSending();

      expect(result).toBe(entity);
      expect(entity.status).toBe(PayInStatus.SENDING);
    });
  });

  describe('#sendUncertain(...)', () => {
    it('sets status to PayInStatus.SEND_UNCERTAIN', () => {
      const entity = createCustomCryptoInput({ id: 1, status: PayInStatus.SENDING });

      const result = entity.sendUncertain();

      expect(result).toBe(entity);
      expect(entity.status).toBe(PayInStatus.SEND_UNCERTAIN);
    });
  });

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
