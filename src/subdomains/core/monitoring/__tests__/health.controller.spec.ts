import { createMock } from '@golevelup/ts-jest';
import { Response } from 'express';
import { HealthController } from '../health.controller';
import { MonitoringService } from '../monitoring.service';

describe('HealthController — address letter check', () => {
  let controller: HealthController;
  let monitoringService: MonitoringService;

  function respond(dispatch: unknown): Promise<{ status: string; checks: Record<string, any> }> {
    jest
      .spyOn(monitoringService, 'getState')
      .mockResolvedValue({ addressLetter: { dispatch: { data: dispatch, updated: new Date() } } });

    return new Promise((resolve) => {
      const res = {
        status: () => res,
        json: (body: any) => resolve(body),
      } as unknown as Response;

      void controller.getHealth(res);
    });
  }

  const healthy = { backlog: 5, claimedWithoutLetter: 0, exhausted: 0, hoursSinceLastLetter: 2 };

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

  it('reports missing data instead of silently passing', async () => {
    const body = await respond(undefined);

    expect(body.checks.addressLetter).toEqual({ status: 'degraded', detail: 'No address letter data' });
  });

  it('never turns a stalled dispatch into a 503 for the whole API', async () => {
    const body = await respond({ backlog: 5000, claimedWithoutLetter: 99, exhausted: 99, hoursSinceLastLetter: 999 });

    expect(body.checks.addressLetter.status).toBe('degraded');
    expect(body.status).not.toBe('down');
  });
});
