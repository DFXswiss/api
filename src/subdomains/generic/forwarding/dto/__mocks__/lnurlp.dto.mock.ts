import { LnurlPayRequestDto } from '../../../../../integration/lightning/dto/lnurlp.dto';

const defaultLnurlpRequest: Partial<LnurlPayRequestDto> = {
  tag: 'payRequest',
  minSendable: 98765,
  maxSendable: 1234567890,
  metadata: '[["text/plain", "DFX Deposit Test Address"]]',
};

export function createDefaultLnurlpRequest(): LnurlPayRequestDto {
  return createCustomLnurlpLRequest({});
}

export function createCustomLnurlpLRequest(customValues: Partial<LnurlPayRequestDto>): LnurlPayRequestDto {
  return Object.assign({ ...defaultLnurlpRequest, ...customValues });
}
