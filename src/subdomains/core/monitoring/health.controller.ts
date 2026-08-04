import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { MonitoringService } from './monitoring.service';
import { SystemState } from './system-state-snapshot.entity';

enum HealthStatus {
  OK = 'ok',
  DEGRADED = 'degraded',
  DOWN = 'down',
}

interface HealthCheckResult {
  status: HealthStatus;
  checks: Record<string, { status: HealthStatus; detail?: string }>;
}

@Controller('health')
@ApiExcludeController()
export class HealthController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get()
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();

    const checks: HealthCheckResult['checks'] = {};
    let overall = HealthStatus.OK;

    // DB check (if we got state, DB works)
    checks.database = state ? { status: HealthStatus.OK } : { status: HealthStatus.DOWN, detail: 'No state available' };

    // Node health
    const nodeHealth = this.checkNodes(state);
    checks.nodes = nodeHealth;

    // Payment pipeline
    const payment = this.checkPayment(state);
    checks.payment = payment;

    // Liquidity & trading
    const liquidity = this.checkLiquidity(state);
    checks.liquidity = liquidity;

    // External services
    const external = this.checkExternalServices(state);
    checks.externalServices = external;

    // Banking
    const banking = this.checkBanking(state);
    checks.banking = banking;

    // Address verification letters
    const addressLetter = this.checkAddressLetter(state);
    checks.addressLetter = addressLetter;

    // Determine overall status
    const statuses = Object.values(checks).map((c) => c.status);
    if (statuses.includes(HealthStatus.DOWN)) overall = HealthStatus.DOWN;
    else if (statuses.includes(HealthStatus.DEGRADED)) overall = HealthStatus.DEGRADED;

    const result: HealthCheckResult = { status: overall, checks };
    const httpStatus = overall === HealthStatus.DOWN ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

    res.status(httpStatus).json(result);
  }

  @Get('nodes')
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getNodeHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkNodes(state);
    this.respond(res, check);
  }

  @Get('payment')
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getPaymentHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkPayment(state);
    this.respond(res, check);
  }

  @Get('liquidity')
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getLiquidityHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkLiquidity(state);
    this.respond(res, check);
  }

  @Get('banking')
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getBankingHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkBanking(state);
    this.respond(res, check);
  }

  @Get('external')
  @Version(VERSION_NEUTRAL)
  @HttpCode(HttpStatus.OK)
  async getExternalHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkExternalServices(state);
    this.respond(res, check);
  }

  // --- Private helpers --- //

  private async getState(): Promise<SystemState | null> {
    try {
      return (await this.monitoringService.getState(undefined, undefined)) as SystemState;
    } catch {
      return null;
    }
  }

  private respond(res: Response, check: { status: HealthStatus; detail?: string }): void {
    const httpStatus = check.status === HealthStatus.DOWN ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;
    res.status(httpStatus).json(check);
  }

  private checkNodes(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const data = state?.node?.health?.data as { type: string; nodes: { isDown: boolean }[] }[];
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No node data' };

    const downNodes = data.flatMap((pool) => pool.nodes.filter((n) => n.isDown));
    if (downNodes.length === 0) return { status: HealthStatus.OK };

    const totalNodes = data.flatMap((pool) => pool.nodes).length;
    if (downNodes.length === totalNodes) return { status: HealthStatus.DOWN, detail: `All ${totalNodes} nodes down` };

    return { status: HealthStatus.DEGRADED, detail: `${downNodes.length}/${totalNodes} nodes down` };
  }

  private checkPayment(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const data = state?.payment?.combined?.data as {
      stuckPayments?: number;
      stuckFiatOutputs?: number;
      unhandledCryptoInputs?: number;
    };
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No payment data' };

    const issues: string[] = [];
    if (data.stuckPayments > 0) issues.push(`${data.stuckPayments} stuck quotes`);
    if (data.stuckFiatOutputs > 0) issues.push(`${data.stuckFiatOutputs} stuck fiat outputs`);
    if (data.unhandledCryptoInputs > 5) issues.push(`${data.unhandledCryptoInputs} unhandled inputs`);

    if (issues.length === 0) return { status: HealthStatus.OK };
    return { status: HealthStatus.DEGRADED, detail: issues.join(', ') };
  }

  private checkLiquidity(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const data = state?.liquidity?.trading?.data as {
      stuckLiquidityOrderCount?: number;
      stuckTradingOrderCount?: number;
      krakenSyncDelay?: number;
      binanceSyncDelay?: number;
      safetyModeActive?: boolean;
    };
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No liquidity data' };

    if (data.safetyModeActive) return { status: HealthStatus.DOWN, detail: 'Safety mode active' };

    const issues: string[] = [];
    if (data.stuckTradingOrderCount > 0) issues.push(`${data.stuckTradingOrderCount} stuck trading orders`);
    if (data.stuckLiquidityOrderCount > 0) issues.push(`${data.stuckLiquidityOrderCount} stuck liquidity orders`);
    if (data.krakenSyncDelay > 30) issues.push(`Kraken sync ${data.krakenSyncDelay}min behind`);
    if (data.binanceSyncDelay > 30) issues.push(`Binance sync ${data.binanceSyncDelay}min behind`);

    if (issues.length === 0) return { status: HealthStatus.OK };
    return { status: HealthStatus.DEGRADED, detail: issues.join(', ') };
  }

  private checkBanking(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const data = state?.bank?.balance?.data as { name: string; difference: number }[];
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No banking data' };

    const largeDiscrepancies = data.filter((b) => Math.abs(b.difference) > 10000);
    if (largeDiscrepancies.length === 0) return { status: HealthStatus.OK };

    const details = largeDiscrepancies.map((b) => `${b.name}: ${b.difference}`).join(', ');
    return { status: HealthStatus.DEGRADED, detail: `Balance discrepancy: ${details}` };
  }

  /**
   * Address verification letters (`AddressLetterObserver`). The signal that matters is age, not size:
   * during the multi-day outage that preceded this job, the backlog looked unremarkable while no letter
   * had gone out for days, and every status display stayed green.
   *
   * Never reports DOWN. A stalled letter dispatch is an operational problem, not a reason to answer
   * `/health` with 503 and let a load balancer take a perfectly healthy API process out of service.
   */
  private checkAddressLetter(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const metric = state?.addressLetter?.dispatch;
    const data = metric?.data as {
      backlog?: number;
      claimedWithoutLetter?: number;
      exhausted?: number;
      sentWithoutFile?: number;
      hoursSinceLastLetter?: number | null;
      letterBalance?: number | null;
    };
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No address letter data' };

    const { maxHoursWithoutLetter, backlogThreshold, maxObservationAgeMinutes, minBalance } =
      Config.letter.addressLetter;

    const issues: string[] = [];
    // The values below are only as current as the observation they come from. When the observer stops
    // running, the snapshot freezes at its last good values and every check below keeps answering `ok`
    // - a stalled dispatch behind healthy-looking numbers, which is the failure this job exists to end.
    // Parsed JSON carries `updated` as a string, the in-memory state as a Date; an unreadable one
    // counts as stale rather than as fresh.
    const observedAt = metric.updated ? new Date(metric.updated).getTime() : NaN;
    const observationAge = Util.minutesDiff(new Date(observedAt));
    if (!Number.isFinite(observedAt) || observationAge > maxObservationAgeMinutes)
      issues.push(`observation ${Number.isFinite(observedAt) ? `${Util.round(observationAge, 0)}min old` : 'undated'}`);
    // A few dozen letters a day is the normal load, so a day without one is a broken dispatch. Checked
    // only while there is something to send - a genuinely empty queue must not raise an alert. A null
    // age means no letter was EVER sent, which with a non-empty queue is the same broken dispatch: it
    // has to be tested explicitly, because `null > n` is false and would otherwise read as healthy.
    if (data.backlog > 0) {
      if (data.hoursSinceLastLetter == null) issues.push('no letter ever sent');
      else if (data.hoursSinceLastLetter > maxHoursWithoutLetter)
        issues.push(`no letter sent for ${data.hoursSinceLastLetter}h`);
    }
    // Credit at the provider decides whether anything can go out at all, and it runs out silently:
    // every send simply fails. Only reported while there is something to send, and `null` counts -
    // it means the provider is unconfigured or did not answer, which blocks the queue just the same.
    if (data.backlog > 0) {
      // `Number.isFinite` rather than a null check: `getBalance` coerces the provider's value with `+`,
      // so a non-numeric answer arrives as NaN - and NaN passes both `== null` and `<= minBalance`,
      // reading as healthy. Unusable and absent are the same thing here.
      if (!Number.isFinite(data.letterBalance)) issues.push('provider balance unknown');
      else if (data.letterBalance <= minBalance) issues.push(`provider balance ${data.letterBalance}`);
    }
    if (data.claimedWithoutLetter > 0) issues.push(`${data.claimedWithoutLetter} claims with unknown outcome`);
    if (data.exhausted > 0) issues.push(`${data.exhausted} accounts out of retries`);
    // A dispatched letter whose document never reached the store: the letter is out, the compliance
    // record is not. Reported, because nothing else would ever surface it.
    if (data.sentWithoutFile > 0) issues.push(`${data.sentWithoutFile} letters without a document`);
    if (data.backlog > backlogThreshold) issues.push(`${data.backlog} letters queued`);

    if (issues.length === 0) return { status: HealthStatus.OK };
    return { status: HealthStatus.DEGRADED, detail: issues.join(', ') };
  }

  private checkExternalServices(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const raw = state?.externalServices?.combined?.data as { name: string; status: string }[];
    if (!raw) return { status: HealthStatus.DEGRADED, detail: 'No external services data' };

    const data = raw.filter(Boolean);
    if (data.length === 0) return { status: HealthStatus.DEGRADED, detail: 'No external services data' };

    const offline = data.filter((s) => s.status === 'Offline');
    if (offline.length === 0) return { status: HealthStatus.OK };

    if (offline.length === data.length) {
      return { status: HealthStatus.DOWN, detail: `All services offline: ${offline.map((s) => s.name).join(', ')}` };
    }

    return { status: HealthStatus.DEGRADED, detail: `Offline: ${offline.map((s) => s.name).join(', ')}` };
  }
}
