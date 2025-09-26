import { RegisterStrategy } from './register.strategy';

export abstract class PollingStrategy extends RegisterStrategy {
  private blockHeight = -1;

  abstract getBlockHeight(): Promise<number>;
  abstract processNewPayInEntries(): Promise<void>;

  async checkPayInEntries(): Promise<void> {
    if (await this.hasNewBlock()) await this.processNewPayInEntries();
  }

  private async hasNewBlock(): Promise<boolean> {
    const currentBlockHeight = await this.getBlockHeight();
    if (this.blockHeight === currentBlockHeight) return false;

    this.blockHeight = currentBlockHeight;
    return true;
  }
}
