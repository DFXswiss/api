import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { SendType } from 'src/subdomains/supporting/payin/strategies/send/impl/base/send-type.enum';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';

describe('CryptoInput', () => {
  describe('#verifyForwardFee(...)', () => {
    it('blocks a forward when the fee exceeds the frozen order cap', () => {
      expect(() => CryptoInput.verifyForwardFee(0.02, 0.0147, 55, 100, SendType.FORWARD)).toThrow(
        FeeLimitExceededException,
      );
    });

    it('passes a forward when the fee stays within the frozen order cap', () => {
      expect(() => CryptoInput.verifyForwardFee(0.0147, 0.0147, 55, 100, SendType.FORWARD)).not.toThrow();
    });

    it('passes a return despite a low order cap (uses the global fee cap)', () => {
      expect(() => CryptoInput.verifyForwardFee(0.02, 0.0147, 55, 100, SendType.RETURN)).not.toThrow();
    });

    it('blocks a return when the fee exceeds the global fee cap (fail-closed)', () => {
      expect(() => CryptoInput.verifyForwardFee(60, 0.0147, 55, 100, SendType.RETURN)).toThrow(
        FeeLimitExceededException,
      );
    });

    it('passes a return with a zero order cap by falling back to the global fee cap', () => {
      expect(() => CryptoInput.verifyForwardFee(0.02, 0, 55, 100, SendType.RETURN)).not.toThrow();
    });

    it('passes a return within a high order cap above the policy fee', () => {
      expect(() => CryptoInput.verifyForwardFee(58, 60, 55, 100, SendType.RETURN)).not.toThrow();
    });

    it('blocks a return above a high order cap above the policy fee', () => {
      expect(() => CryptoInput.verifyForwardFee(61, 60, 55, 100, SendType.RETURN)).toThrow(FeeLimitExceededException);
    });

    it('throws when no fee estimation is provided', () => {
      expect(() => CryptoInput.verifyForwardFee(null, 0.0147, 55, 100, SendType.FORWARD)).toThrow(
        'No fee estimation provided',
      );
    });

    it('throws when no maximum fee is provided', () => {
      expect(() => CryptoInput.verifyForwardFee(0.02, null, 55, 100, SendType.FORWARD)).toThrow(
        'No maximum fee provided',
      );
    });

    it('throws when the total forward amount is zero', () => {
      expect(() => CryptoInput.verifyForwardFee(0.02, 0.0147, 55, 0, SendType.FORWARD)).toThrow(
        'Total forward amount cannot be zero',
      );
    });
  });
});
