import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ObservableResult } from '@opentelemetry/api';
import { MetricService } from 'src/shared/services/metric.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { JobGroup, JobPhase, JobStatus } from '../../enums';
import { JOB_GROUP_DEFAULTS } from '../../job-group.config';
import { JobRepository } from '../../repositories/job.repository';
import { JobMetricService } from '../job-metric.service';
import { JobService } from '../job.service';

describe('JobMetricService', () => {
  let service: JobMetricService;
  let jobRepo: JobRepository;
  let metricService: MetricService;
  let jobService: JobService;
  const gaugeCallbacks = new Map<string, (result: ObservableResult) => void | Promise<void>>();

  beforeEach(async () => {
    jobRepo = createMock<JobRepository>();
    metricService = createMock<MetricService>();
    jobService = createMock<JobService>();
    gaugeCallbacks.clear();

    jest.spyOn(metricService, 'registerGauge').mockImplementation((name, _unit, observe) => {
      gaugeCallbacks.set(name, observe);
    });
    jest.spyOn(jobService, 'getConfig').mockImplementation(async (group) => JOB_GROUP_DEFAULTS[group]);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        JobMetricService,
        { provide: JobRepository, useValue: jobRepo },
        { provide: MetricService, useValue: metricService },
        { provide: JobService, useValue: jobService },
      ],
    }).compile();

    service = module.get<JobMetricService>(JobMetricService);
    service.onModuleInit();
  });

  it('updateSnapshot counts overSlaRun for PROCESSING jobs older than maxRunSeconds', async () => {
    const config = JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE];
    jest.spyOn(jobRepo, 'countBy').mockImplementation(async (where) => {
      const criteria = Array.isArray(where) ? where[0] : where;
      if (criteria && 'status' in criteria && criteria.status === JobStatus.PROCESSING && 'startedAt' in criteria) {
        return 3;
      }
      if (criteria && 'status' in criteria && criteria.status === JobStatus.DEAD_LETTER) {
        return 0;
      }
      return 0;
    });
    jest.spyOn(jobRepo, 'findOne').mockResolvedValue(null);

    await service.updateSnapshot();

    const overSlaCalls = (jobRepo.countBy as jest.Mock).mock.calls.filter((call) => {
      const where = call[0] as { status?: JobStatus; startedAt?: unknown };
      return where && where.status === JobStatus.PROCESSING && where.startedAt !== undefined;
    });
    expect(overSlaCalls).toHaveLength(1);
    expect(overSlaCalls[0][0]).toEqual(
      expect.objectContaining({
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.PROCESSING,
      }),
    );
    expect(overSlaCalls[0][0].startedAt).toBeDefined();

    const observe = jest.fn();
    const overSlaGauge = gaugeCallbacks.get('dfx_job_over_sla');
    expect(overSlaGauge).toBeDefined();
    await overSlaGauge!({ observe } as unknown as ObservableResult);

    expect(observe).toHaveBeenCalledWith(3, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.RUN,
    });
    expect(observe).toHaveBeenCalledWith(0, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.WAIT,
    });

    // Sanity: SLA configured limit matches defaults used for the cutoff.
    expect(config.maxRunSeconds).toBe(60);
  });

  it('gauge callbacks report the snapshot without querying the database again', async () => {
    jest.spyOn(jobRepo, 'countBy').mockResolvedValue(7);
    jest.spyOn(jobRepo, 'findOne').mockResolvedValue(null);

    await service.updateSnapshot();

    const countByCallsAfterSnapshot = (jobRepo.countBy as jest.Mock).mock.calls.length;
    const findOneCallsAfterSnapshot = (jobRepo.findOne as jest.Mock).mock.calls.length;
    expect(countByCallsAfterSnapshot).toBeGreaterThan(0);
    expect(findOneCallsAfterSnapshot).toBeGreaterThan(0);

    const observe = jest.fn();
    for (const callback of gaugeCallbacks.values()) {
      await callback({ observe } as unknown as ObservableResult);
    }

    expect(jobRepo.countBy).toHaveBeenCalledTimes(countByCallsAfterSnapshot);
    expect(jobRepo.findOne).toHaveBeenCalledTimes(findOneCallsAfterSnapshot);

    expect(observe).toHaveBeenCalledWith(7, { group: JobGroup.ACCOUNT_MERGE });
    expect(observe).toHaveBeenCalledWith(7, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.WAIT,
    });
    expect(observe).toHaveBeenCalledWith(7, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.RUN,
    });
    expect(observe).toHaveBeenCalledWith(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE].maxWaitSeconds, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.WAIT,
    });
    expect(observe).toHaveBeenCalledWith(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE].maxRunSeconds, {
      group: JobGroup.ACCOUNT_MERGE,
      phase: JobPhase.RUN,
    });
  });
});
