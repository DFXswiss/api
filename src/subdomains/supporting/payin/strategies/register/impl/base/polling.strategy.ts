import { DfxLogger } from 'src/shared/services/dfx-logger';
import { RegisterStrategy } from './register.strategy';

export abstract class PollingStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(PollingStrategy);

  private blockHeight = -1;

  protected abstract getBlockHeight(): Promise<number>;
  protected abstract processNewPayInEntries(): Promise<void>;

  async checkPayInEntries(): Promise<void> {
    const currentBlockHeight = await this.getBlockHeight();

    if (this.blockHeight < currentBlockHeight) {
      await this.processNewPayInEntries();
      this.blockHeight = currentBlockHeight;
    }
  }
}
