import { createCustomCryptoInput } from '../__mocks__/crypto-input.entity.mock';
import { PayInAction, PayInStatus } from '../crypto-input.entity';

describe('CryptoInput', () => {
  describe('#designateSending(...)', () => {
    it('sets status to PayInStatus.SENDING', () => {
      const entity = createCustomCryptoInput({ id: 1, status: PayInStatus.PREPARED });

      const result = entity.designateSending();

      expect(result).toBe(entity);
      expect(entity.status).toBe(PayInStatus.SENDING);
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

  describe('#resetSend(...)', () => {
    it('returns a FORWARD SendUncertain pay-in to Acknowledged', () => {
      const entity = createCustomCryptoInput({
        id: 1,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.FORWARD,
      });

      const [id, update] = entity.resetSend();

      expect(id).toBe(1);
      expect(update).toEqual({ status: PayInStatus.ACKNOWLEDGED });
      expect(entity.status).toBe(PayInStatus.ACKNOWLEDGED);
    });

    it('returns a RETURN SendUncertain pay-in to ToReturn', () => {
      const entity = createCustomCryptoInput({ id: 2, status: PayInStatus.SEND_UNCERTAIN, action: PayInAction.RETURN });

      const [id, update] = entity.resetSend();

      expect(id).toBe(2);
      expect(update).toEqual({ status: PayInStatus.TO_RETURN });
      expect(entity.status).toBe(PayInStatus.TO_RETURN);
    });

    it('throws when the action is neither Forward nor Return', () => {
      const entity = createCustomCryptoInput({
        id: 3,
        status: PayInStatus.SEND_UNCERTAIN,
        action: PayInAction.WAITING,
      });

      expect(() => entity.resetSend()).toThrow();
    });
  });
});
