import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM, Log, LogSeverity } from '../log.entity';
import { LogRepository } from '../log.repository';
import { LogService, MAX_VALIDITY_SWEEP_ROWS } from '../log.service';

describe('LogService', () => {
  let service: LogService;
  let logRepo: LogRepository;
  let settingService: SettingService;

  beforeEach(async () => {
    logRepo = createMock<LogRepository>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        LogService,
        { provide: LogRepository, useValue: logRepo },
        { provide: SettingService, useValue: settingService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<LogService>(LogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setFinancialLogValidity', () => {
    it('should throw if no filter is provided', async () => {
      await expect(service.setFinancialLogValidity(42, { valid: false, reference: 'ticket SUP-123' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if from is after to', async () => {
      await expect(
        service.setFinancialLogValidity(42, {
          valid: false,
          from: new Date('2026-06-19'),
          to: new Date('2026-06-18'),
          reference: 'ticket SUP-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if min is not smaller than max', async () => {
      await expect(
        service.setFinancialLogValidity(42, {
          valid: false,
          min: 60000,
          max: 60000,
          reference: 'ticket SUP-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should write the audit log before delegating to the repository and return the affected count', async () => {
      const auditLog = new Log();
      const saveSpy = jest.spyOn(logRepo, 'save').mockResolvedValue(auditLog);
      const updateSpy = jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(2);
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([
        { id: 11, valid: true },
        { id: 12, valid: null },
      ]);
      jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);

      const dto = { valid: false, from: new Date('2026-06-18'), min: 60000, reference: 'ticket SUP-123' };
      const result = await service.setFinancialLogValidity(42, dto);

      expect(logRepo.getFinancialLogValidityChangeSet).toHaveBeenCalledWith(dto);
      expect(saveSpy).toHaveBeenCalledWith(auditLog);
      expect(logRepo.setFinancialLogValidity).toHaveBeenCalledWith(dto, [11, 12]);
      expect(saveSpy.mock.invocationCallOrder[0]).toBeLessThan(updateSpy.mock.invocationCallOrder[0]);
      expect(result).toEqual({ affected: 2 });
    });

    it('should pass exactly the audited IDs to the repository update', async () => {
      const auditLog = new Log();
      const dto = { valid: false, from: new Date('2026-06-18'), reference: 'ticket SUP-123' };
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([
        { id: 11, valid: true },
        { id: 12, valid: null },
        { id: 15, valid: true },
      ]);
      jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);
      jest.spyOn(logRepo, 'save').mockResolvedValue(auditLog);
      const updateSpy = jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(3);

      await service.setFinancialLogValidity(42, dto);

      expect(updateSpy).toHaveBeenCalledWith(dto, [11, 12, 15]);
    });

    it('should reject a changeset above the sweep limit before writing or updating', async () => {
      jest
        .spyOn(logRepo, 'getFinancialLogValidityChangeSet')
        .mockResolvedValue(
          Array.from({ length: MAX_VALIDITY_SWEEP_ROWS + 1 }, (_, index) => ({ id: index + 1, valid: true })),
        );
      const saveSpy = jest.spyOn(logRepo, 'save');
      const updateSpy = jest.spyOn(logRepo, 'setFinancialLogValidity');

      await expect(
        service.setFinancialLogValidity(42, {
          valid: false,
          from: new Date('2026-06-18'),
          reference: 'ticket SUP-123',
        }),
      ).rejects.toThrow(
        `Financial log validity sweep matches ${MAX_VALIDITY_SWEEP_ROWS + 1} rows, exceeding the limit of ${MAX_VALIDITY_SWEEP_ROWS}; narrow the time or amount range`,
      );

      expect(saveSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should fail closed if the audit write fails', async () => {
      const auditError = new Error('audit write failed');
      const auditLog = new Log();
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([{ id: 11, valid: true }]);
      jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);
      jest.spyOn(logRepo, 'save').mockRejectedValue(auditError);
      const updateSpy = jest.spyOn(logRepo, 'setFinancialLogValidity');

      await expect(
        service.setFinancialLogValidity(42, {
          valid: false,
          from: new Date('2026-06-18'),
          reference: 'ticket SUP-123',
        }),
      ).rejects.toBe(auditError);

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should skip the audit write and update for an empty changeset', async () => {
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([]);
      const createSpy = jest.spyOn(logRepo, 'create');
      const saveSpy = jest.spyOn(logRepo, 'save');
      const updateSpy = jest.spyOn(logRepo, 'setFinancialLogValidity');

      const result = await service.setFinancialLogValidity(42, {
        valid: false,
        from: new Date('2026-06-18'),
        reference: 'ticket SUP-123',
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ affected: 0 });
    });

    it('should persist the previous validity values grouped by value', async () => {
      const auditLog = new Log();
      const from = new Date('2026-06-18');
      const to = new Date('2026-06-19');
      const createSpy = jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);
      jest.spyOn(logRepo, 'save').mockResolvedValue(auditLog);
      jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(5);
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([
        { id: 11, valid: true },
        { id: 12, valid: false },
        { id: 13, valid: null },
        { id: 14, valid: true },
        { id: 15, valid: null },
      ]);

      await service.setFinancialLogValidity(42, {
        valid: false,
        from,
        to,
        min: 50000,
        max: 60000,
        reference: 'ticket SUP-123',
      });

      expect(createSpy).toHaveBeenCalledWith({
        system: 'LogService',
        subsystem: FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          accountId: 42,
          valid: false,
          from,
          to,
          min: 50000,
          max: 60000,
          reference: 'ticket SUP-123',
          auditedRows: 5,
          previous: { true: [11, 14], false: [12], null: [13, 15] },
        }),
      });
    });

    it('should log an error when the affected count differs from the audited row count', async () => {
      const auditLog = new Log();
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([
        { id: 11, valid: true },
        { id: 12, valid: null },
      ]);
      jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);
      jest.spyOn(logRepo, 'save').mockResolvedValue(auditLog);
      jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(1);
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.setFinancialLogValidity(42, {
        valid: false,
        from: new Date('2026-06-18'),
        reference: 'ticket SUP-123',
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        'Financial log validity audit/update divergence: audited 2 rows, actually affected 1 rows',
      );
    });

    it('should write an operations log with the reference, affected count and null filters', async () => {
      const auditLog = new Log();
      const from = new Date('2026-06-18');
      jest.spyOn(logRepo, 'getFinancialLogValidityChangeSet').mockResolvedValue([{ id: 11, valid: true }]);
      jest.spyOn(logRepo, 'create').mockReturnValue(auditLog);
      jest.spyOn(logRepo, 'save').mockResolvedValue(auditLog);
      jest.spyOn(logRepo, 'setFinancialLogValidity').mockResolvedValue(1);
      const loggerSpy = jest.spyOn((service as any).logger, 'info');

      await service.setFinancialLogValidity(42, {
        valid: false,
        from,
        reference: 'ticket SUP-123',
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        `Financial log validity set to false by account 42: filters ${JSON.stringify({
          from,
          to: null,
          min: null,
          max: null,
        })}, reference: ticket SUP-123, affected 1`,
      );
    });
  });

  describe('update', () => {
    it('should reject updates to financial log validity audit records', async () => {
      const auditLog = Object.assign(new Log(), {
        id: 11,
        system: 'LogService',
        subsystem: FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM,
        severity: LogSeverity.INFO,
        message: '{}',
      });
      jest.spyOn(logRepo, 'findOneBy').mockResolvedValue(auditLog);
      const saveSpy = jest.spyOn(logRepo, 'save');

      await expect(service.update(11, { message: 'changed', category: 'audit', valid: true })).rejects.toThrow(
        BadRequestException,
      );

      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});
