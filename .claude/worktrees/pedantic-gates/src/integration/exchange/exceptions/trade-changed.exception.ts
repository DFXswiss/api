export class TradeChangedException extends Error {
  constructor(public readonly id: string) {
    super();
  }
}
