import { IEvent } from 'src/poc/shared/events/event';

export interface LiquiditySecuredEventPayload {
  securedAsset: string;
  securedAmount: number;
}

export class LiquiditySecuredEvent extends IEvent {
  constructor(readonly correlationId: string, readonly payload: LiquiditySecuredEventPayload) {
    super(correlationId, payload);
  }
}
