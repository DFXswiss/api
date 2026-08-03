import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService, GetConfig } from 'src/config/config';
import { Setting } from 'src/shared/models/setting/setting.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { StatisticService } from 'src/subdomains/core/statistic/statistic.service';
import * as ProcessService from 'src/shared/services/process.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';

describe('StatisticService', () => {
  let service: StatisticService;
  let settingService: jest.Mocked<SettingService>;

  beforeEach(async () => {
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatisticService,
        { provide: BuyService, useValue: createMock<BuyService>() },
        { provide: SellService, useValue: createMock<SellService>() },
        { provide: SettingService, useValue: settingService },
        { provide: UserService, useValue: createMock<UserService>() },
      ],
    }).compile();

    service = module.get(StatisticService);
  });

  describe('getStatus', () => {
    it('loads only status settings', async () => {
      settingService.getStatusSettings.mockResolvedValue([]);

      await service.getStatus();

      expect(settingService.getStatusSettings).toHaveBeenCalled();
      expect(settingService.getAll).not.toHaveBeenCalled();
    });

    it('maps status settings to status keys and values', async () => {
      settingService.getStatusSettings.mockResolvedValue([
        Object.assign(new Setting(), { key: 'buyStatus', value: 'Available' }),
        Object.assign(new Setting(), { key: 'sellStatus', value: 'Limited' }),
      ]);

      await expect(service.getStatus()).resolves.toEqual({ buy: 'Available', sell: 'Limited' });
    });

    it('returns an empty object when there are no status settings', async () => {
      settingService.getStatusSettings.mockResolvedValue([]);

      await expect(service.getStatus()).resolves.toEqual({});
    });
  });

  /**
   * `doUpdate` is scoped `api` AND leased, so it runs in ONE api process per tick. Everything the
   * request path reads therefore has to be fillable from the request path — CONTRIBUTING: "A cron
   * job may refresh it, but must not be the only thing filling it."
   */
  describe('getAll', () => {
    it('fills the statistic when there is none, instead of answering with nothing', async () => {
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      await service.getAll();

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('serves what is on hand without asking again', async () => {
      service['statistic'] = { at: new Date(), data: { totalVolume: { buy: 1, sell: 2 } } as never };
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      await expect(service.getAll()).resolves.toEqual({ totalVolume: { buy: 1, sell: 2 } });
      expect(update).not.toHaveBeenCalled();
    });

    it('refreshes what has aged past the job it complements', async () => {
      // A second api process — a blue-green window, a `--scale` — loses the lease on every tick
      // and would otherwise serve what it read at boot for the rest of its life.
      service['statistic'] = { at: new Date(Date.now() - 61 * 60 * 1000), data: {} as never };
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      await service.getAll();

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('starts ONE refresh for concurrent readers', async () => {
      // The field is written when a refresh resolves, so without the in-flight promise every
      // request arriving until then starts its own — and one refresh is four aggregations over
      // the whole volume history.
      let finish: () => void;
      const update = jest
        .spyOn(service, 'doUpdate')
        .mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));

      const calls = [service.getAll(), service.getAll(), service.getAll()];
      await new Promise((resolve) => setImmediate(resolve));
      finish();
      await Promise.all(calls);

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('answers with what it has when the refresh fails', async () => {
      // The endpoint is public and read-only: an aggregation that cannot run right now says
      // nothing about the numbers already here.
      service['statistic'] = { at: new Date(Date.now() - 61 * 60 * 1000), data: { old: true } as never };
      jest.spyOn(service, 'doUpdate').mockRejectedValue(new Error('aggregation failed'));
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await expect(service.getAll()).resolves.toEqual({ old: true });
    });

    it('lets the next reader retry after a failed refresh', async () => {
      const update = jest
        .spyOn(service, 'doUpdate')
        .mockRejectedValueOnce(new Error('aggregation failed'))
        .mockResolvedValue(undefined);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service.getAll();
      await service.getAll();

      expect(update).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * The start-up fill runs outside the scheduler, so none of the conditions the scheduler applies
   * to `doUpdate` reached it: not the scope, not the process flag, not any error handling. Each
   * test below is one of those.
   */
  describe('start-up fill', () => {
    const originalRole = process.env.CRON_ROLE;

    function withRole(role: string): void {
      process.env.CRON_ROLE = role;
      new ConfigService(GetConfig());
    }

    beforeEach(() => {
      jest.spyOn(ProcessService, 'DisabledProcess').mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();

      if (originalRole == null) delete process.env.CRON_ROLE;
      else process.env.CRON_ROLE = originalRole;

      new ConfigService(GetConfig());
    });

    it('does not run in the worker process', () => {
      // The job is scoped `api`: a request path is the only reader of the field it writes. Run
      // here regardless, the worker spent the aggregation queries once per boot on a value no
      // request in that process can read — and outside the lease, so nothing reported it.
      withRole('worker');
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      service.onModuleInit();

      expect(update).not.toHaveBeenCalled();
    });

    it.each(['api', 'all'])('runs in the %s process', (role) => {
      // The counterpart: where the job belongs, getAll would answer with undefined until the
      // first scheduled run an hour later.
      withRole(role);
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      service.onModuleInit();

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('stays off when the process flag is off', () => {
      // Switching a job off has to switch it off, not leave one run per deployment behind.
      jest.spyOn(ProcessService, 'DisabledProcess').mockReturnValue(true);
      withRole('api');
      const update = jest.spyOn(service, 'doUpdate').mockResolvedValue(undefined);

      service.onModuleInit();

      expect(update).not.toHaveBeenCalled();
    });

    it('reports a failed fill instead of leaving an unhandled rejection', async () => {
      // `void this.doUpdate()` without a catch turns a failing query at boot into an unhandled
      // rejection.
      withRole('api');
      const failure = new Error('aggregation failed');
      jest.spyOn(service, 'doUpdate').mockRejectedValue(failure);
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();

      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      service.onModuleInit();
      await new Promise((resolve) => setImmediate(resolve));

      process.off('unhandledRejection', unhandled);

      expect(unhandled).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith('Failed to fill the statistic at start-up:', failure);
    });
  });
});
