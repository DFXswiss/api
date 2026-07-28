import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { EntityManager } from 'typeorm';
import { KycLog } from '../../entities/kyc-log.entity';
import { KycLogType } from '../../enums/kyc.enum';
import { KycLogRepository } from '../../repositories/kyc-log.repository';
import { KycLogService } from '../kyc-log.service';

describe('KycLogService merge effect completion', () => {
  it('writes both account completion records atomically through one transaction manager', async () => {
    const master = Object.assign(new UserData(), { id: 1000 });
    const slave = Object.assign(new UserData(), { id: 2000 });
    const txRepo = {
      create: jest.fn((_entity) => _entity),
      save: jest.fn(async (entity) => entity),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(txRepo),
    } as unknown as EntityManager;
    const kycLogRepo = {
      manager: {
        transaction: jest.fn(async (run: (transactionManager: EntityManager) => Promise<void>) => run(manager)),
      },
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as KycLogRepository;
    const service = new KycLogService(kycLogRepo, undefined as never, undefined as never);
    const log = 'merge; postCommitEffectCompleted=document copy';

    await service.createMergeEffectCompletionLogs(master, slave, log);

    expect(kycLogRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).toHaveBeenCalledTimes(2);
    expect(manager.getRepository).toHaveBeenCalledWith(KycLog);
    expect(txRepo.create).toHaveBeenNthCalledWith(1, {
      type: KycLogType.MERGE,
      result: log,
      userData: master,
    });
    expect(txRepo.create).toHaveBeenNthCalledWith(2, {
      type: KycLogType.MERGE,
      result: log,
      userData: slave,
    });
    expect(txRepo.save).toHaveBeenCalledTimes(2);
    expect(kycLogRepo.save).not.toHaveBeenCalled();
  });
});
