import { TatumWebhookDto } from './tatum.dto';

export class TatumWebhookPayloadMapper {
  static payloadToWebhookDto(payload: any): TatumWebhookDto {
    return {
      address: payload.address,
      amount: payload.amount,
      counterAddresses: TatumWebhookPayloadMapper.getCounterAddresses(payload),
      asset: payload.asset,
      type: payload.type,
      blockNumber: payload.blockNumber,
      txId: payload.txId,
      addressesRiskRatio: payload.addressesRiskRatio,
      subscriptionId: payload.subscriptionId,
      subscriptionType: payload.subscriptionType,
      chain: payload.chain,
    };
  }

  private static getCounterAddresses(payload: any): string[] {
    if (payload.counterAddress) return [payload.counterAddress];
    if (payload.counterAddresses instanceof Array) return payload.counterAddresses;
    if (payload.counterAddresses instanceof Object) {
      return Object.values<string>(payload.counterAddresses);
    }

    return [];
  }
}
