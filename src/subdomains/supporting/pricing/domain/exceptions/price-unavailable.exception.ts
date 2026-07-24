import { PriceInvalidException } from './price-invalid.exception';

// transient price-source outage (connection-class failure): safe to treat as heal-on-retry, unlike the other
// PriceInvalidException causes (config/data/programming errors)
export class PriceUnavailableException extends PriceInvalidException {
  constructor(
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
  }
}
