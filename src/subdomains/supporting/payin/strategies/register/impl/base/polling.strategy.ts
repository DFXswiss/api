import { NodeNotReadyError } from 'src/integration/blockchain/bitcoin/node/rpc';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { RegisterStrategy } from './register.strategy';

// A normal node restart warms up in ~1 min. If it stays in warmup past this, the
// node is likely stuck (e.g. reindex / wedged verify) and pay-in scanning is
// effectively halted — so we stop staying quiet and surface a real error.
export const NODE_WARMUP_ESCALATE_MS = 10 * 60 * 1000;

export abstract class PollingStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(PollingStrategy);

  private blockHeight = -1;
  private warmupSince?: number;
  private warmupEscalated = false;

  protected abstract getBlockHeight(): Promise<number>;
  protected abstract processNewPayInEntries(): Promise<void>;

  async checkPayInEntries(): Promise<void> {
    try {
      const currentBlockHeight = await this.getBlockHeight();

      this.warmupSince = undefined;
      this.warmupEscalated = false;

      if (this.blockHeight < currentBlockHeight) {
        await this.processNewPayInEntries();
        this.blockHeight = currentBlockHeight;
      }
    } catch (e) {
      // Node restarting/warming up (e.g. after a deploy): transient. The cron runs
      // every second, so without this a ~1 min warmup emits dozens of spurious errors.
      // Either RPC (getBlockHeight or processNewPayInEntries) can hit warmup if the
      // node restarts mid-cycle; blockHeight only advances on success, so a skipped
      // cycle is reprocessed without duplication.
      if (e instanceof NodeNotReadyError) {
        this.handleNodeWarmup();
        return;
      }
      throw e;
    }
  }

  private handleNodeWarmup(): void {
    const now = Date.now();

    if (this.warmupSince == null) {
      this.warmupSince = now;
      this.logger.warn('Node warming up — skipping pay-in check until ready');
    } else if (!this.warmupEscalated && now - this.warmupSince > NODE_WARMUP_ESCALATE_MS) {
      this.warmupEscalated = true;
      this.logger.error(
        `Node still warming up after ${Math.round((now - this.warmupSince) / 60000)} min — pay-in scanning is stalled`,
      );
    }
  }
}
