import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyIncomingTypes, CustodyOrderStatus, CustodyOrderType, CustodySwapTypes } from '../../enums/custody';

export class CustodyOrderListEntry {
  id: number;
  type: CustodyOrderType;
  status: CustodyOrderStatus;
  inputAmount?: number;
  inputAsset?: string;
  outputAmount?: number;
  outputAsset?: string;
  userDataId?: number;
  userName?: string;
  updated: Date;

  static fromEntity(order: CustodyOrder): CustodyOrderListEntry {
    const isIncoming = CustodyIncomingTypes.includes(order.type);
    const isSwap = CustodySwapTypes.includes(order.type);

    return {
      id: order.id,
      type: order.type,
      status: order.status,
      inputAmount:
        isIncoming || isSwap ? (order.inputAmount ?? order.transactionRequest?.estimatedAmount) : order.inputAmount,
      inputAsset: order.inputAsset?.name,
      outputAmount: isIncoming ? order.outputAmount : (order.outputAmount ?? order.transactionRequest?.amount),
      outputAsset: order.outputAsset?.name,
      userDataId: order.user?.userData?.id,
      userName: order.user?.userData?.verifiedName,
      updated: order.updated,
    };
  }
}
