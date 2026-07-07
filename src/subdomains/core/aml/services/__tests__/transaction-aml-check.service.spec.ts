import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import * as processServiceModule from 'src/shared/services/process.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { CreateTransactionAmlCheckDto } from '../../dto/create-transaction-aml-check.dto';
import { AmlSourceType, TransactionAmlCheck } from '../../entities/transaction-aml-check.entity';
import { AmlReason } from '../../enums/aml-reason.enum';
import { CheckStatus } from '../../enums/check-status.enum';
import { TransactionAmlCheckRepository } from '../../repositories/transaction-aml-check.repository';
import { TransactionAmlCheckService } from '../transaction-aml-check.service';

const sampleDto = (): CreateTransactionAmlCheckDto => ({
  transaction: Object.assign(new Transaction(), { id: 42 }),
  entityType: 'BuyCrypto',
  entityId: 7,
  source: AmlSourceType.MANUAL_PASS,
  previousAmlCheck: CheckStatus.PENDING,
  amlCheck: CheckStatus.PASS,
  previousAmlReason: AmlReason.MANUAL_CHECK_PHONE,
  amlReason: AmlReason.NA,
  amlResponsible: 'Compliance Clerk',
  comment: 'ManualCheckPhone',
  priceDefinitionAllowedDate: new Date('2026-07-01T00:00:00.000Z'),
  highRisk: false,
});

describe('TransactionAmlCheckService', () => {
  let service: TransactionAmlCheckService;
  let repo: TransactionAmlCheckRepository;

  beforeEach(async () => {
    repo = createMock<TransactionAmlCheckRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionAmlCheckService, { provide: TransactionAmlCheckRepository, useValue: repo }],
    }).compile();

    service = module.get<TransactionAmlCheckService>(TransactionAmlCheckService);

    // Enable the audit writes for the write-path tests: DisabledProcess is fail-closed by sentinel
    // (returns true while the disabled-process map is undefined, as it is in tests).
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('maps the DTO to a row and persists it exactly once', async () => {
    const dto = sampleDto();
    const created = Object.assign(new TransactionAmlCheck(), dto);
    jest.spyOn(repo, 'create').mockReturnValue(created);
    jest.spyOn(repo, 'save').mockResolvedValue(Object.assign(new TransactionAmlCheck(), { id: 1, ...dto }));

    await service.create(dto);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(dto);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(created);
  });

  it('is fail-open: a repository failure is swallowed and never rethrown into the calling operation', async () => {
    jest.spyOn(repo, 'create').mockReturnValue(new TransactionAmlCheck());
    jest.spyOn(repo, 'save').mockRejectedValue(new Error('db unavailable'));

    // Must resolve (not reject) — a failed secondary audit copy must never break the operation it rides on.
    await expect(service.create(sampleDto())).resolves.toBeUndefined();
  });

  it('writes nothing when the process kill-switch (TRANSACTION_AML_CHECK_LOG) is disabled', async () => {
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);

    await service.create(sampleDto());

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('exposes only append operations (create / createFromEntity) — no update / delete / save (immutable by construction)', () => {
    expect(typeof service.create).toBe('function');
    expect(typeof service.createFromEntity).toBe('function');
    expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).save).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  describe('createFromEntity', () => {
    const transaction = Object.assign(new Transaction(), { id: 1 });

    it('early-returns (no create / save) when neither amlCheck nor amlReason changed', async () => {
      const entity = {
        id: 3,
        transaction,
        amlCheck: CheckStatus.PENDING,
        amlReason: AmlReason.MANUAL_CHECK_PHONE,
      };

      await service.createFromEntity(
        entity,
        'BuyCrypto',
        AmlSourceType.AML_CHECK_CRON,
        CheckStatus.PENDING,
        AmlReason.MANUAL_CHECK_PHONE,
      );

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('emits exactly one row (reading NEW values off the entity) on a real transition', async () => {
      const entity = {
        id: 3,
        transaction,
        amlCheck: CheckStatus.PASS,
        amlReason: AmlReason.NA,
        amlResponsible: 'API',
        comment: 'ManualCheckPhone',
        priceDefinitionAllowedDate: new Date('2026-07-01T00:00:00.000Z'),
        highRisk: false,
      };
      const created = Object.assign(new TransactionAmlCheck(), {});
      jest.spyOn(repo, 'create').mockReturnValue(created);
      jest.spyOn(repo, 'save').mockResolvedValue(Object.assign(new TransactionAmlCheck(), { id: 1 }));

      await service.createFromEntity(
        entity,
        'BuyCrypto',
        AmlSourceType.MANUAL_PASS,
        CheckStatus.PENDING,
        AmlReason.MANUAL_CHECK_PHONE,
      );

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction,
          entityType: 'BuyCrypto',
          entityId: 3,
          source: AmlSourceType.MANUAL_PASS,
          previousAmlCheck: CheckStatus.PENDING,
          amlCheck: CheckStatus.PASS,
          previousAmlReason: AmlReason.MANUAL_CHECK_PHONE,
          amlReason: AmlReason.NA,
          amlResponsible: 'API',
          comment: 'ManualCheckPhone',
          highRisk: false,
        }),
      );
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledWith(created);
    });
  });
});
