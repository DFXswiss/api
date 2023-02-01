import { PayoutOrder, PayoutOrderContext } from '../entities/payout-order.entity';

export class PayoutUtils {
  static groupOrdersByContext(orders: PayoutOrder[]): Map<PayoutOrderContext, PayoutOrder[]> {
    const groups = new Map<PayoutOrderContext, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.context);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.context, [order]);
      }
    });

    return groups;
  }
}
