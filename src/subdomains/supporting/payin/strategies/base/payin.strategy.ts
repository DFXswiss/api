export abstract class PayInStrategy {
  abstract checkPayInEntries(): Promise<void>;
}
