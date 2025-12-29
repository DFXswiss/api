import { LnurlWithdrawRequestDto } from '../../../../../integration/lightning/dto/lnurlw.dto';

const defaultLnurlwRequest: Partial<LnurlWithdrawRequestDto> = {
  tag: 'withdrawRequest',
  k1: 'AG8JL3VMWuhJk6UYPJJGSf',
  minWithdrawable: 25000,
  maxWithdrawable: 25000,
  defaultDescription: 'DFX Withdraw Test Address',
};

export function createDefaultLnurlwLRequest(): LnurlWithdrawRequestDto {
  return createCustomLnurlwRequest({});
}

export function createCustomLnurlwRequest(customValues: Partial<LnurlWithdrawRequestDto>): LnurlWithdrawRequestDto {
  return Object.assign({ ...defaultLnurlwRequest, ...customValues });
}
