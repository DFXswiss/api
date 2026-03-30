import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';

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
      inputAmount: order.inputAmount ?? tr?.estimatedAmount,
      inputAsset: order.inputAsset?.name,
      outputAmount: order.outputAmount ?? tr?.amount,
      outputAsset: order.outputAsset?.name,
      userDataId: order.user?.userData?.id,
      userName: order.user?.userData?.verifiedName,
      updated: order.updated,
    };
  }
}
