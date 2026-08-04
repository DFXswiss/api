import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { Response } from 'express';
import { HealthController } from '../health.controller';
import { MonitoringService } from '../monitoring.service';

describe('HealthController — address letter check', () => {
  let controller: HealthController;
  let monitoringService: MonitoringService;

  function respond(
    dispatch: unknown,
    updated: unknown = new Date(),
  ): Promise<{
    status: string;
    checks: Record<string, any>;
  }> {
    jest
      .spyOn(monitoringService, 'getState')
      .mockResolvedValue({ addressLetter: { dispatch: { data: dispatch, updated } } } as never);

    return new Promise((resolve) => {
      const res = {
        status: () => res,
        json: (body: any) => resolve(body),
      } as unknown as Response;

      void controller.getHealth(res);
    });
  }

  const healthy = {
    backlog: 5,
    claimedWithoutLetter: 0,
    exhausted: 0,
    sentWithoutFile: 0,
    hoursSinceLastLetter: 2,
    letterBalance: 42,
  };

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    monitoringService = createMock<MonitoringService>();
    controller = new HealthController(monitoringService);
  });

  it('is ok while letters keep going out', async () => {
    const body = await respond(healthy);

    expect(body.checks.addressLetter).toEqual({ status: 'ok' });
  });

  it('reports a dispatch that stopped, which is what the outage before this job looked like', async () => {
    const body = await respond({ ...healthy, hoursSinceLastLetter: 48 });

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.checks.addressLetter.detail).toContain('no letter sent for 48h');
  });

  it('stays quiet about the age while there is nothing to send', async () => {
    const body = await respond({ ...healthy, backlog: 0, hoursSinceLastLetter: 48 });

    expect(body.checks.addressLetter).toEqual({ status: 'ok' });
  });

  it('reports a single claim with an unknown outcome — every one of them needs a human', async () => {
    const body = await respond({ ...healthy, claimedWithoutLetter: 1 });

    expect(body.checks.addressLetter.detail).toContain('1 claims with unknown outcome');
  });

  it('reports accounts that ran out of retries', async () => {
    const body = await respond({ ...healthy, exhausted: 2 });

    expect(body.checks.addressLetter.detail).toContain('2 accounts out of retries');
  });

  it('reports a queue that grew past the daily load', async () => {
    const body = await respond({ ...healthy, backlog: 101 });

    expect(body.checks.addressLetter.detail).toContain('101 letters queued');
  });

  it('reports a queue where no letter was ever sent — null is not healthy', async () => {
    const body = await respond({ ...healthy, hoursSinceLastLetter: null });

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.checks.addressLetter.detail).toContain('no letter ever sent');
  });

  it('reports a dispatched letter whose document never reached the store', async () => {
    const body = await respond({ ...healthy, sentWithoutFile: 3 });

    expect(body.checks.addressLetter.detail).toContain('3 letters without a document');
  });

  it('reports an observation that stopped being refreshed', async () => {
    // the metrics freeze at their last good values when the observer stops running, and frozen healthy
    // values look exactly like healthy ones
    const body = await respond(healthy, new Date(Date.now() - 3 * 60 * 60 * 1000));

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.checks.addressLetter.detail).toContain('180min old');
  });

  it('accepts a timestamp that survived JSON as a string', async () => {
    const body = await respond(healthy, new Date().toISOString());

    expect(body.checks.addressLetter).toEqual({ status: 'ok' });
  });

  it('treats an undated observation as stale rather than fresh', async () => {
    // `null`, not `undefined`: passing `undefined` would fall back to the default parameter above
    const body = await respond(healthy, null);

    expect(body.checks.addressLetter.detail).toContain('undated');
  });

  it('reports an exhausted provider balance before the letters start failing', async () => {
    const body = await respond({ ...healthy, letterBalance: 0 });

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.checks.addressLetter.detail).toContain('provider balance 0');
  });

  it('reports an unknown provider balance — unconfigured or unreachable blocks the queue too', async () => {
    const body = await respond({ ...healthy, letterBalance: null });

    expect(body.checks.addressLetter.detail).toContain('provider balance unknown');
  });

  it('treats a balance that is not a number as unknown', async () => {
    // `getBalance` coerces with `+`, so a non-numeric provider value arrives as NaN
    const body = await respond({ ...healthy, letterBalance: Number.NaN });

    expect(body.checks.addressLetter.detail).toContain('provider balance unknown');
  });

  it('stays quiet about the balance while there is nothing to send', async () => {
    const body = await respond({ ...healthy, backlog: 0, letterBalance: null });

    expect(body.checks.addressLetter).toEqual({ status: 'ok' });
  });

  it('reports missing data instead of silently passing', async () => {
    const body = await respond(undefined);

    expect(body.checks.addressLetter).toEqual({ status: 'degraded', detail: 'No address letter data' });
  });

  it('never turns a stalled dispatch into a 503 for the whole API', async () => {
    const body = await respond({
      backlog: 5000,
      claimedWithoutLetter: 99,
      exhausted: 99,
      sentWithoutFile: 99,
      hoursSinceLastLetter: 999,
      letterBalance: null,
    });

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.status).not.toBe('down');
  });
});
