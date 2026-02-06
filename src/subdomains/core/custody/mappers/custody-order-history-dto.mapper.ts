import { CustodyOrderHistoryDto, CustodyOrderHistoryStatus } from '../dto/output/custody-order-history.dto';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyIncomingTypes, CustodyOrderStatus, CustodySwapTypes } from '../enums/custody';

export class CustodyOrderHistoryDtoMapper {
  static mapList(orders: CustodyOrder[]): CustodyOrderHistoryDto[] {
    return orders.map((order) => this.map(order));
  }

  static map(order: CustodyOrder): CustodyOrderHistoryDto {
    const isIncoming = CustodyIncomingTypes.includes(order.type);
    const isSwap = CustodySwapTypes.includes(order.type);

    return {
      type: order.type,
      status: this.mapStatus(order),
      inputAmount: isIncoming || isSwap ? order.inputAmount ?? order.transactionRequest?.estimatedAmount : order.inputAmount,
      inputAsset: order.inputAsset?.name,
      outputAmount: isIncoming ? order.outputAmount : order.outputAmount ?? order.transactionRequest?.amount,
      outputAsset: order.outputAsset?.name,
    };
  }

  private static mapStatus(order: CustodyOrder): CustodyOrderHistoryStatus {
    const isIncoming = CustodyIncomingTypes.includes(order.type);

    switch (order.status) {
      case CustodyOrderStatus.CONFIRMED:
        return isIncoming ? CustodyOrderHistoryStatus.WAITING_FOR_PAYMENT : CustodyOrderHistoryStatus.CHECK_PENDING;

      case CustodyOrderStatus.APPROVED:
      case CustodyOrderStatus.IN_PROGRESS:
        return CustodyOrderHistoryStatus.PROCESSING;

      case CustodyOrderStatus.COMPLETED:
        return CustodyOrderHistoryStatus.COMPLETED;

      case CustodyOrderStatus.FAILED:
        return CustodyOrderHistoryStatus.FAILED;
    }
  }
}
