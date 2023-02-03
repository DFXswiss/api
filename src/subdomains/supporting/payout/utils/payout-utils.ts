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

  static groupOrdersByAssetId(orders: PayoutOrder[]): Map<number, PayoutOrder[]> {
    const groups = new Map<number, PayoutOrder[]>();

    orders.forEach((order) => {
      const existingGroup = groups.get(order.asset.id);

      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(order.asset.id, [order]);
      }
    });

    return groups;
  }
}
