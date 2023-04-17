export class BadPriceRequestException extends Error {
  constructor(from?: string, to?: string) {
    const fromMessage = from ? `From: ${from}.` : '';
    const toMessage = to ? `To: ${to}.` : '';

    super(`Bad PriceRequest. Provided currencies are not supported. ${fromMessage} ${toMessage}`);
  }
}
