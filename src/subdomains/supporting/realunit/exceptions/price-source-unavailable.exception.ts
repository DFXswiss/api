import { ServiceUnavailableException } from '@nestjs/common';

export class PriceSourceUnavailableException extends ServiceUnavailableException {
  constructor(message = 'RealUnit price source (Aktionariat) is currently unavailable') {
    super({
      code: 'PRICE_SOURCE_UNAVAILABLE',
      message,
    });
  }
}
