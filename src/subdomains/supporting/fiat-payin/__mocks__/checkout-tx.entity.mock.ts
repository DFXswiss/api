import { CheckoutTx } from '../entities/checkout-tx.entity';

const defaultCheckoutTx: Partial<CheckoutTx> = {
  id: 1,
  amount: 100,
};

export function createDefaultCheckoutTx(): CheckoutTx {
  return createCustomCheckoutTx({});
}

export function createCustomCheckoutTx(customValues: Partial<CheckoutTx>): CheckoutTx {
  return Object.assign(new CheckoutTx(), { ...defaultCheckoutTx, ...customValues });
}
