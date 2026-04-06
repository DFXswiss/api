import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
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

@ApiTags('Health')
@Controller('health')
@ApiExcludeController()
export class HealthController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get()
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

    // Determine overall status
    const statuses = Object.values(checks).map((c) => c.status);
    if (statuses.includes(HealthStatus.DOWN)) overall = HealthStatus.DOWN;
    else if (statuses.includes(HealthStatus.DEGRADED)) overall = HealthStatus.DEGRADED;

    const result: HealthCheckResult = { status: overall, checks };
    const httpStatus = overall === HealthStatus.DOWN ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

    res.status(httpStatus).json(result);
  }

  @Get('nodes')
  @HttpCode(HttpStatus.OK)
  async getNodeHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkNodes(state);
    this.respond(res, check);
  }

  @Get('payment')
  @HttpCode(HttpStatus.OK)
  async getPaymentHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkPayment(state);
    this.respond(res, check);
  }

  @Get('liquidity')
  @HttpCode(HttpStatus.OK)
  async getLiquidityHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkLiquidity(state);
    this.respond(res, check);
  }

  @Get('banking')
  @HttpCode(HttpStatus.OK)
  async getBankingHealth(@Res() res: Response): Promise<void> {
    const state = await this.getState();
    const check = this.checkBanking(state);
    this.respond(res, check);
  }

  @Get('external')
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
      stuckPaymentQuoteCount?: number;
      unhandledCryptoInputCount?: number;
    };
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No payment data' };

    const issues: string[] = [];
    if (data.stuckPaymentQuoteCount > 0) issues.push(`${data.stuckPaymentQuoteCount} stuck quotes`);
    if (data.unhandledCryptoInputCount > 5) issues.push(`${data.unhandledCryptoInputCount} unhandled inputs`);

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

  private checkExternalServices(state: SystemState | null): { status: HealthStatus; detail?: string } {
    const data = state?.externalServices?.combined?.data as { name: string; status: string }[];
    if (!data) return { status: HealthStatus.DEGRADED, detail: 'No external services data' };

    const offline = data.filter((s) => s.status === 'Offline');
    if (offline.length === 0) return { status: HealthStatus.OK };

    if (offline.length === data.length) {
      return { status: HealthStatus.DOWN, detail: `All services offline: ${offline.map((s) => s.name).join(', ')}` };
    }

    return { status: HealthStatus.DEGRADED, detail: `Offline: ${offline.map((s) => s.name).join(', ')}` };
  }
}
