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
  userId?: number;
  userName?: string;
  created: Date;

  static fromEntity(order: CustodyOrder): CustodyOrderListEntry {
    return {
      id: order.id,
      type: order.type,
      status: order.status,
      inputAmount: order.inputAmount,
      inputAsset: order.inputAsset?.name,
      outputAmount: order.outputAmount,
      outputAsset: order.outputAsset?.name,
      userId: order.user?.userData?.id,
      userName: order.user?.userData?.verifiedName,
      created: order.created,
    };
  }
}
