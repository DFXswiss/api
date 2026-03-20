import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyOrder } from '../../entities/custody-order.entity';

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
    const tr = order.transactionRequest;

    return {
      id: order.id,
      type: order.type,
      status: order.status,
      inputAmount: order.inputAmount ?? tr?.amount,
      inputAsset: order.inputAsset?.name,
      outputAmount: order.outputAmount ?? tr?.estimatedAmount,
      outputAsset: order.outputAsset?.name,
      userDataId: order.user?.userData?.id,
      userName: order.user?.userData?.verifiedName,
      updated: order.updated,
    };
  }
}
