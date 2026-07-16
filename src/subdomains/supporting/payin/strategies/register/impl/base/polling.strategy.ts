import { NodeNotReadyError } from 'src/integration/blockchain/bitcoin/node/rpc';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { isConnectionFailure, OutageLogger } from 'src/shared/utils/outage-logger';
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
  private outage?: OutageLogger;

  protected abstract getBlockHeight(): Promise<number>;
  protected abstract processNewPayInEntries(): Promise<void>;

  async checkPayInEntries(): Promise<void> {
    const currentBlockHeight = await this.pollBlockHeight();
    if (currentBlockHeight == null || this.blockHeight >= currentBlockHeight) return;

    try {
      await this.processNewPayInEntries();
      this.blockHeight = currentBlockHeight;
    } catch (e) {
      // Node restarting/warming up (e.g. after a deploy): transient. The cron runs
      // every second, so without this a ~1 min warmup emits dozens of spurious errors.
      // blockHeight only advances on success, so a skipped cycle is reprocessed without
      // duplication.
      if (e instanceof NodeNotReadyError) {
        this.handleNodeWarmup();
        return;
      }

      // Deliberately not classified as a node outage here: this call also does DB
      // writes, and a connection-shaped message from those would misattribute a
      // database problem as "node unreachable". Only the node probe below gets that
      // treatment; anything from here throws loudly, same as any other real bug.
      throw e;
    }
  }

  // The node probe: cheap, side-effect-free, and the one call whose connection failures
  // are safely attributable to the node itself — so it's the only place an outage is
  // opened, tracked, and closed.
  private async pollBlockHeight(): Promise<number | undefined> {
    try {
      const height = await this.getBlockHeight();

      this.warmupSince = undefined;
      this.warmupEscalated = false;
      this.nodeOutage.recovered();

      return height;
    } catch (e) {
      if (e instanceof NodeNotReadyError) {
        this.handleNodeWarmup();
        return undefined;
      }

      // Node down (wedged daemon, restart in flight): a real outage, but one incident —
      // not one error per polling cycle. The outage stays visible as a single ERROR at
      // onset and an INFO with duration on recovery; anything non-connection-shaped
      // (parse errors, bugs) still throws loudly every cycle.
      if (e instanceof Error && isConnectionFailure(e)) {
        this.nodeOutage.failure(e);
        return undefined;
      }

      throw e;
    }
  }

  // Lazily built so the subclass field initializers (blockchain, logger) are set.
  private get nodeOutage(): OutageLogger {
    return (this.outage ??= new OutageLogger(this.logger, `${this.blockchain} node`));
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
