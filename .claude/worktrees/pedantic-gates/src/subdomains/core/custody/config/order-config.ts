import { CustodyOrderStepCommand, CustodyOrderStepContext, CustodyOrderType } from '../enums/custody';

export const OrderConfig: {
  [t in CustodyOrderType]: { context: CustodyOrderStepContext; command: CustodyOrderStepCommand }[];
} = {
  [CustodyOrderType.DEPOSIT]: [],
  [CustodyOrderType.WITHDRAWAL]: [
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.CHARGE_ROUTE },
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.SEND_TO_ROUTE },
  ],
  [CustodyOrderType.RECEIVE]: [],
  [CustodyOrderType.SEND]: [
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.CHARGE_ROUTE },
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.SEND_TO_ROUTE },
  ],
  [CustodyOrderType.SWAP]: [
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.CHARGE_ROUTE },
    { context: CustodyOrderStepContext.DFX, command: CustodyOrderStepCommand.SEND_TO_ROUTE },
  ],
  [CustodyOrderType.SAVING_DEPOSIT]: [],
  [CustodyOrderType.SAVING_WITHDRAWAL]: [],
};
