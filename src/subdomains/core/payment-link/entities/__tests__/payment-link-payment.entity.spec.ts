import { readFileSync } from 'fs';
import { join } from 'path';
import { DefaultNamingStrategy, getMetadataArgsStorage } from 'typeorm';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../../enums';
import { PaymentLinkPayment } from '../payment-link-payment.entity';

const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'migration',
  '1785620000000-AddPaymentLinkPaymentDeviceIdIndex.js',
);

describe('PaymentLinkPayment', () => {
  function payment(values: Partial<PaymentLinkPayment>): PaymentLinkPayment {
    return Object.assign(new PaymentLinkPayment(), {
      status: PaymentLinkPaymentStatus.PENDING,
      mode: PaymentLinkPaymentMode.SINGLE,
      txCount: 0,
      ...values,
    });
  }

  describe('waitState', () => {
    it('changes when the payment leaves pending', () => {
      expect(payment({ status: PaymentLinkPaymentStatus.COMPLETED }).waitState).not.toEqual(payment({}).waitState);
    });

    it('changes when a MULTIPLE-mode payment counts another completed quote', () => {
      const before = payment({ mode: PaymentLinkPaymentMode.MULTIPLE, txCount: 1 });
      const after = payment({ mode: PaymentLinkPaymentMode.MULTIPLE, txCount: 2 });

      expect(after.waitState).not.toEqual(before.waitState);
    });

    it('stays the same across changes a caller is not waiting for', () => {
      expect(payment({ isConfirmed: true, note: 'edited' }).waitState).toEqual(payment({}).waitState);
    });
  });

  describe('deviceId index', () => {
    /**
     * `deliverToConnectedDevices` looks payments up by `deviceId`, and the index backing that is
     * created by a hand-written migration. Nothing in the running application compares the two —
     * the next `npm run migration` does, and an entity that has drifted from the migration produces
     * a migration "fixing" the difference in the direction of the entity.
     */
    it('is declared on the entity under the name the migration creates', () => {
      const declared = getMetadataArgsStorage().indices.filter((index) => index.target === PaymentLinkPayment);

      expect(declared.map((index) => index.columns)).toContainEqual(['deviceId']);

      const name = new DefaultNamingStrategy().indexName('payment_link_payment', ['deviceId']);

      expect(readFileSync(MIGRATION, 'utf8')).toContain(
        `CREATE INDEX "${name}" ON "payment_link_payment" ("deviceId")`,
      );
    });
  });
});
