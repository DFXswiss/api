import { CustodyOrderStepContext, CustodyOrderType } from '../enums/custody';

export const OrderConfig: { [t in CustodyOrderType]: { context: CustodyOrderStepContext; command: string }[] } = {
  [CustodyOrderType.DEPOSIT]: [],
  [CustodyOrderType.WITHDRAWAL]: [{ context: CustodyOrderStepContext.DFX, command: 'SendToRoute' }],
  [CustodyOrderType.SWAP]: [{ context: CustodyOrderStepContext.DFX, command: 'SendToRoute' }],
  [CustodyOrderType.SAVING_DEPOSIT]: [],
  [CustodyOrderType.SAVING_WITHDRAWAL]: [],
};
