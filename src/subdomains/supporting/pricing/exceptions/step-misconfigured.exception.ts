export class StepMisconfiguredException extends Error {
  constructor(message: string) {
    super(`PriceStep init specification is not satisfied: ${message}`);
  }
}
