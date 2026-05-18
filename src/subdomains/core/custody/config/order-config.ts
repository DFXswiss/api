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
  [CustodyOrderType.EQUITY_MINT]: [
    { context: CustodyOrderStepContext.EQUITY, command: CustodyOrderStepCommand.CHARGE_CUSTODY },
    { context: CustodyOrderStepContext.EQUITY, command: CustodyOrderStepCommand.APPROVE_TOKEN },
    { context: CustodyOrderStepContext.EQUITY, command: CustodyOrderStepCommand.MINT },
  ],
  [CustodyOrderType.EQUITY_REDEEM]: [
    { context: CustodyOrderStepContext.EQUITY, command: CustodyOrderStepCommand.CHARGE_CUSTODY },
    { context: CustodyOrderStepContext.EQUITY, command: CustodyOrderStepCommand.REDEEM },
  ],
  [CustodyOrderType.SAVING_DEPOSIT]: [],
  [CustodyOrderType.SAVING_WITHDRAWAL]: [],
};
