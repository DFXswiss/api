import { createMock } from '@golevelup/ts-jest';
import { CronExpression } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Process } from 'src/shared/services/process.service';
import { DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DataSource, FindOperator, FindOptionsWhere, Repository } from 'typeorm';
import { BankService } from '../../bank/bank.service';
import { FrickVibanProvider } from '../providers/frick-viban.provider';
import { VirtualIbanFrickIssuanceReconciliationService } from '../virtual-iban-frick-issuance-reconciliation.service';
import { VirtualIbanIssuanceEvent } from '../virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntent, VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent.entity';
import { CREATE_PATH_REFERENCE_MARKER, MERGE_SUPERSEDED_MARKER, VirtualIbanService } from '../virtual-iban.service';

describe('VirtualIbanFrickIssuanceReconciliationService', () => {
  let service: VirtualIbanFrickIssuanceReconciliationService;
  let eventRepo: { find: jest.Mock };
  let intentRepo: { find: jest.Mock };
  let frickVibanProvider: FrickVibanProvider;
  let bankService: BankService;
  let notificationService: NotificationService;
  let virtualIbanService: VirtualIbanService;

  const referenceAccountIban = 'LI32088110105923K000C';
  const bankId = 50;
  const abandonedCreate = 'dfx-viban-abandonedcreate000000001';
  const abandonedRecovery = 'dfx-viban-abandonedrecovery0000001';
  const stuckRequestReference = 'dfx-viban-stuckintent000000000001';

  function event(partial: Partial<VirtualIbanIssuanceEvent> & { nextError: string }): VirtualIbanIssuanceEvent {
    return Object.assign(new VirtualIbanIssuanceEvent(), {
      id: 10,
      intentId: 20,
      userDataId: 30,
      currencyId: 40,
      bankId,
      previousStatus: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
      previousVirtualIbanId: null,
      nextVirtualIbanId: null,
      previousError: null,
      created: new Date('2026-07-01T12:00:00.000Z'),
      ...partial,
    });
  }

  function intent(
    partial: Partial<VirtualIbanIssuanceIntent> & { requestReference: string },
  ): VirtualIbanIssuanceIntent {
    return Object.assign(new VirtualIbanIssuanceIntent(), {
      id: 100,
      userDataId: 30,
      currencyId: 40,
      bankId,
      status: VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      externalIban: null,
      error: null,
      updated: new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 1_000,
      ),
      created: new Date('2026-07-01T12:00:00.000Z'),
      ...partial,
    });
  }

  function listingEntry(description: string) {
    return {
      vban: 'LI11ACTIVE00000000001',
      referenceAccountIban,
      state: 'ACTIVE' as any,
      createdAt: '2026-07-01T00:00:00Z',
      createdBy: 'synthetic',
      activationApprovals: [],
      deactivationApprovals: [],
      description,
    };
  }

  function listingResult(virtualIbans: ReturnType<typeof listingEntry>[], fullyValidated: boolean) {
    const listingStartedAt = new Date();
    return { virtualIbans, fullyValidated, listingStartedAt, listingCompletedAt: new Date() };
  }

  beforeEach(async () => {
    eventRepo = { find: jest.fn().mockResolvedValue([]) };
    intentRepo = { find: jest.fn().mockResolvedValue([]) };
    frickVibanProvider = createMock<FrickVibanProvider>();
    bankService = createMock<BankService>();
    notificationService = createMock<NotificationService>();
    virtualIbanService = createMock<VirtualIbanService>();

    jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(true);
    jest.spyOn(bankService, 'getBankById').mockResolvedValue({ id: bankId, iban: referenceAccountIban } as any);
    jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined as any);
    jest.spyOn(virtualIbanService, 'resetStuckFrickIntentForReconciliationOnly').mockResolvedValue(true);

    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === VirtualIbanIssuanceIntent) return intentRepo as unknown as Repository<VirtualIbanIssuanceIntent>;
        if (entity === VirtualIbanIssuanceEvent) return eventRepo as unknown as Repository<VirtualIbanIssuanceEvent>;
        throw new Error(`Unexpected repository request for ${entity?.name ?? entity}`);
      }),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VirtualIbanFrickIssuanceReconciliationService,
        { provide: DataSource, useValue: dataSource },
        { provide: FrickVibanProvider, useValue: frickVibanProvider },
        { provide: BankService, useValue: bankService },
        { provide: NotificationService, useValue: notificationService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
      ],
    }).compile();

    service = module.get(VirtualIbanFrickIssuanceReconciliationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers an hourly @DfxCron with the VirtualIbanFrickIssuanceReconciliation process', () => {
    const params: DfxCronParams = Reflect.getMetadata(
      DFX_CRONJOB_PARAMS,
      VirtualIbanFrickIssuanceReconciliationService.prototype.reconcileRetiredIssuanceReferences,
    );
    expect(params.expression).toBe(CronExpression.EVERY_HOUR);
    expect(params.process).toBe(Process.VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION);
    expect(params.timeout).toBe(1800);
  });

  it('silently no-ops when the Frick vIBAN rail is not available', async () => {
    jest.spyOn(frickVibanProvider, 'isAvailable').mockReturnValue(false);

    await service.reconcileRetiredIssuanceReferences();

    expect(intentRepo.find).not.toHaveBeenCalled();
    expect(eventRepo.find).not.toHaveBeenCalled();
    expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
    expect(notificationService.sendMail).not.toHaveBeenCalled();
  });

  it('extracts abandoned references from both exact nextError shapes', () => {
    expect(
      service.extractAbandonedReference(
        `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
      ),
    ).toBe(abandonedCreate);
    expect(
      service.extractAbandonedReference(
        `recovery listing found no match under requestReference=${abandonedRecovery}; resetting to Pending with requestReference=dfx-viban-new`,
      ),
    ).toBe(abandonedRecovery);
  });

  describe('Phase 1 — stuck InFlight/Failed intents', () => {
    it('alerts and does not reset when the Frick listing already contains the intent requestReference', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 101,
          requestReference: stuckRequestReference,
          updated: new Date(
            Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 1_000,
          ),
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 1: stuck intent(s) already exist at Bank Frick',
          errors: [expect.stringContaining(`requestReference=${stuckRequestReference}`)],
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors[0]).toContain('intentId=101');
      expect(mailArg.input.errors[0]).toContain(`bankId=${bankId}`);
    });

    it('skips intents younger than the safety threshold and does not reset', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 102,
          requestReference: stuckRequestReference,
          updated: new Date(Date.now() - 60_000),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('resets past-threshold intents with empty fully-validated listing via VirtualIbanService', async () => {
      const pastThresholdUpdated = new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 5_000,
      );
      intentRepo.find.mockResolvedValue([
        intent({
          id: 103,
          requestReference: stuckRequestReference,
          updated: pastThresholdUpdated,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledTimes(1);
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledWith(
        103,
        stuckRequestReference,
        { listingStartedAt: expect.any(Date) },
      );
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('leaves an old intent non-retryable and alerts when the listing began before create processing could end', async () => {
      const updated = new Date(
        Date.now() - VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS - 5_000,
      );
      const currentReference = 'dfx-viban-listing-too-early-00000001';
      intentRepo.find.mockResolvedValue([
        intent({
          id: 113,
          requestReference: currentReference,
          updated,
        }),
      ]);
      const listingStartedAt = new Date(
        updated.getTime() + VirtualIbanFrickIssuanceReconciliationService.FRICK_CREATE_MAX_PROCESSING_MS,
      );
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult([], true),
        listingStartedAt,
        listingCompletedAt: new Date(listingStartedAt.getTime() + 1_000),
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 1: listing does not prove create absence',
          errors: [expect.stringContaining('intentId=113')],
        },
      });
      const mail = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mail.input.errors[0]).toContain(`listingStartedAt=${listingStartedAt.toISOString()}`);
      expect(mail.input.errors[0]).toContain('latestPossibleCreateProcessedAt=');
      expect(mail.input.errors[0]).not.toContain(currentReference);
    });

    it('rejects invalid listing timestamps without reopening an intent', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 114, requestReference: stuckRequestReference })]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue({
        ...listingResult([], true),
        listingStartedAt: new Date('invalid'),
      });

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
    });

    it('does not reset when listing is not fully validated, and alerts incomplete check', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 104,
          requestReference: stuckRequestReference,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 1: listing not fully validated');
      // Default fixture intent is past the safety threshold → escalated chronic signal too.
      expect(subjects).toContain(
        'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
      );
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 1: listing not fully validated',
          errors: [expect.stringContaining('incomplete for those banks')],
        },
      });
    });

    it('still alerts positive matches when listing is not fully validated but does not reset others', async () => {
      intentRepo.find.mockResolvedValue([
        intent({ id: 105, requestReference: stuckRequestReference }),
        intent({ id: 106, requestReference: 'dfx-viban-other-stuck-ref-00000001' }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(stuckRequestReference)], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 1: stuck intent(s) already exist at Bank Frick');
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 1: listing not fully validated');
      // Intent 106 is unmatched and past threshold → chronic escalated alert.
      expect(subjects).toContain(
        'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
      );
    });

    it('sends chronic incomplete listing alert with bankId only when unmatched intent is past threshold', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 107,
          requestReference: stuckRequestReference,
          bankId,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject:
            'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
          errors: [expect.stringContaining(`bankId(s) ${bankId}`)],
        },
      });
      const chronicCall = (notificationService.sendMail as jest.Mock).mock.calls.find(
        (c) =>
          c[0].input.subject ===
          'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
      );
      expect(chronicCall[0].input.errors[0]).not.toContain(stuckRequestReference);
      expect(chronicCall[0].input.errors[0]).not.toContain('LI');
    });

    it('does not send chronic incomplete alert when unmatched intents are still within the safety threshold', async () => {
      intentRepo.find.mockResolvedValue([
        intent({
          id: 108,
          requestReference: stuckRequestReference,
          updated: new Date(Date.now() - 60_000),
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], false));

      await service.reconcileRetiredIssuanceReferences();

      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 1: listing not fully validated');
      expect(subjects).not.toContain(
        'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
      );
    });

    it('continues Phase 1 for healthy banks when one bank throws, and sends per-bank failure alert', async () => {
      const healthyBankId = 51;
      const healthyRef = 'dfx-viban-healthybankintent0000000001';
      intentRepo.find.mockResolvedValue([
        intent({ id: 110, requestReference: stuckRequestReference, bankId }),
        intent({ id: 111, requestReference: healthyRef, bankId: healthyBankId }),
      ]);
      jest.spyOn(bankService, 'getBankById').mockImplementation(async (id: number) => {
        if (id === bankId) return { id: bankId, iban: null } as any;
        if (id === healthyBankId) return { id: healthyBankId, iban: referenceAccountIban } as any;
        throw new Error(`unexpected bank id ${id}`);
      });
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledTimes(1);
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledWith(111, healthyRef, {
        listingStartedAt: expect.any(Date),
      });
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 1: processing failed for one or more banks',
          errors: [expect.stringContaining('Processing threw for 1 bank(s)')],
        },
      });
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).not.toContain('Frick vIBAN retired-reference reconciliation: check could not run');
    });

    it('never resets a merge-superseded FAILED intent even past threshold with empty listing', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const eligibleReference = 'dfx-viban-eligibleforreset000000000001';
      intentRepo.find.mockResolvedValue([
        intent({
          id: 120,
          requestReference: mergeRetiredReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error:
            `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
            `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
        }),
        intent({
          id: 121,
          requestReference: eligibleReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error: 'create failed for an unrelated reason',
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledTimes(1);
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalledWith(
        121,
        eligibleReference,
        { listingStartedAt: expect.any(Date) },
      );
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalledWith(
        120,
        mergeRetiredReference,
      );
    });

    it('skips Phase 1 entirely when every loaded InFlight/Failed intent is merge-superseded', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesupersededonly000000001';
      intentRepo.find.mockResolvedValue([
        intent({
          id: 122,
          requestReference: mergeRetiredReference,
          status: VirtualIbanIssuanceIntentStatus.FAILED,
          error:
            `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
            `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
        }),
      ]);

      await service.reconcileRetiredIssuanceReferences();

      // Filtered out before bank grouping — no listing fetch and no reset work.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('Phase 2 — retired references', () => {
    it('sends no alert when no abandoned references are found', async () => {
      eventRepo.find.mockResolvedValue([]);

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('sends no alert when abandoned references exist but none match the fully-validated Frick listing', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(bankService.getBankById).toHaveBeenCalledWith(bankId);
      expect(frickVibanProvider.listByReferenceAccount).toHaveBeenCalledWith(referenceAccountIban);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('sends exactly one match alert when at least one abandoned reference appears in the Frick listing', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          id: 11,
          intentId: 21,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
        event({
          id: 12,
          intentId: 22,
          userDataId: 31,
          nextError: `recovery listing found no match under requestReference=${abandonedRecovery}; resetting to Pending with requestReference=dfx-viban-new`,
        }),
      ]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(
        listingResult(
          [
            listingEntry(abandonedCreate),
            {
              ...listingEntry('dfx-viban-other'),
              vban: 'LI11ACTIVE00000000002',
              state: 'PREPARED' as any,
              createdAt: '2026-07-02T00:00:00Z',
            },
          ],
          true,
        ),
      );

      await service.reconcileRetiredIssuanceReferences();

      expect(bankService.getBankById).toHaveBeenCalledWith(bankId);
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected',
          errors: [expect.stringContaining(`abandonedReference=${abandonedCreate}`)],
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors).toHaveLength(1);
      expect(mailArg.input.errors[0]).toContain('intentId=21');
      expect(mailArg.input.errors[0]).toContain('userDataId=30');
      expect(mailArg.input.errors[0]).not.toContain(abandonedRecovery);
    });

    it('does not treat unmatched abandoned refs as clean when listing is not fully validated', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], false));

      await service.reconcileRetiredIssuanceReferences();

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 2: listing not fully validated',
          errors: [expect.stringContaining('NOT evidence of a clean state')],
        },
      });
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).not.toContain('Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected');
    });

    it('still alerts orphan matches when listing is incomplete', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedCreate)], false));

      await service.reconcileRetiredIssuanceReferences();

      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).toContain('Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected');
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 2: listing not fully validated');
    });

    it('sends a per-bank failure alert when the Frick listing fetch throws and does not rethrow', async () => {
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockRejectedValue(new Error('upstream listing unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 2: processing failed for one or more banks',
          errors: [expect.stringContaining('Processing threw for 1 bank(s)')],
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      // Alert must not embed the raw upstream failure text (PII / free-form provider content).
      expect(mailArg.input.errors[0]).not.toContain('upstream listing unavailable');
    });

    it('continues Phase 2 for healthy banks when one bank throws, and sends per-bank failure alert', async () => {
      const healthyBankId = 52;
      eventRepo.find.mockResolvedValue([
        event({
          id: 21,
          bankId,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
        event({
          id: 22,
          bankId: healthyBankId,
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedRecovery}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest.spyOn(bankService, 'getBankById').mockImplementation(async (id: number) => {
        if (id === bankId) throw new Error('Frick receive bank id=50 is not configured');
        if (id === healthyBankId) return { id: healthyBankId, iban: referenceAccountIban } as any;
        throw new Error(`unexpected bank id ${id}`);
      });
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry(abandonedRecovery)], true));

      await service.reconcileRetiredIssuanceReferences();

      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).toContain('Frick vIBAN reconciliation Phase 2: processing failed for one or more banks');
      expect(subjects).toContain('Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected');
      expect(subjects).not.toContain('Frick vIBAN retired-reference reconciliation: check could not run');
      const matchCall = (notificationService.sendMail as jest.Mock).mock.calls.find(
        (c) => c[0].input.subject === 'Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected',
      );
      expect(matchCall[0].input.errors[0]).toContain(`abandonedReference=${abandonedRecovery}`);
      expect(matchCall[0].input.errors[0]).not.toContain(abandonedCreate);
    });

    it('queries abandoned references without a rolling time window', async () => {
      eventRepo.find.mockResolvedValue([]);

      await service.reconcileRetiredIssuanceReferences();

      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            expect.objectContaining({
              nextError: expect.anything(),
            }),
            expect.objectContaining({
              nextError: expect.anything(),
            }),
          ],
        }),
      );
      const findArg = eventRepo.find.mock.calls[0][0];
      // Marker presence alone — no nextStatus gate (merge-supersede is nextStatus=Failed).
      expect(findArg.where[0]).not.toHaveProperty('nextStatus');
      expect(findArg.where[1]).not.toHaveProperty('nextStatus');
      // No created: MoreThan(...) time filter — structural markers only.
      expect(findArg.where[0]).not.toHaveProperty('created');
      expect(findArg.where[1]).not.toHaveProperty('created');
    });

    it('finds merge-superseded FAILED events via the real where-clause path (not only extractAbandonedReference)', async () => {
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const phase1ReopenReference = abandonedCreate;
      const unrelatedReference = 'dfx-viban-unrelatedneverretired0000001';

      const mergeSupersededEvent = event({
        id: 31,
        intentId: 41,
        nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        nextError:
          `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
          `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`,
      });
      const phase1ReopenEvent = event({
        id: 32,
        intentId: 42,
        nextStatus: VirtualIbanIssuanceIntentStatus.PENDING,
        nextError:
          `reconciliation: empty listing after safety threshold; ` +
          `${CREATE_PATH_REFERENCE_MARKER}${phase1ReopenReference}; newRequestReference=dfx-viban-new`,
      });
      const unrelatedEvent = event({
        id: 33,
        intentId: 43,
        nextStatus: VirtualIbanIssuanceIntentStatus.FAILED,
        nextError: `create failed for an unrelated reason; requestReference=${unrelatedReference}`,
      });

      const candidatePool = [mergeSupersededEvent, phase1ReopenEvent, unrelatedEvent];

      /**
       * Interprets the TypeORM FindOptionsWhere[] the production code builds (array = OR of
       * clauses; each field is exact equality or a Like FindOperator). Bare mockResolvedValue
       * would ignore `where` and pass even against the old buggy nextStatus=Pending gate.
       */
      function matchesLikePattern(fieldValue: unknown, likePattern: string): boolean {
        if (fieldValue == null) return false;
        const escaped = likePattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        return new RegExp(`^${escaped}$`, 's').test(String(fieldValue));
      }

      function clauseMatchesEntity(
        entity: VirtualIbanIssuanceEvent,
        clause: FindOptionsWhere<VirtualIbanIssuanceEvent>,
      ): boolean {
        for (const [key, condition] of Object.entries(clause)) {
          const fieldValue = (entity as unknown as Record<string, unknown>)[key];
          if (condition instanceof FindOperator) {
            if (condition.type === 'like') {
              if (!matchesLikePattern(fieldValue, String(condition.value))) return false;
            } else {
              throw new Error(`Unexpected FindOperator type in where matcher: ${condition.type}`);
            }
          } else if (fieldValue !== condition) {
            return false;
          }
        }
        return true;
      }

      function entityMatchesWhere(
        entity: VirtualIbanIssuanceEvent,
        where: FindOptionsWhere<VirtualIbanIssuanceEvent> | FindOptionsWhere<VirtualIbanIssuanceEvent>[],
      ): boolean {
        const clauses = Array.isArray(where) ? where : [where];
        return clauses.some((clause) => clauseMatchesEntity(entity, clause));
      }

      eventRepo.find.mockImplementation(async (options?: { where?: unknown }) => {
        const where = options?.where as
          | FindOptionsWhere<VirtualIbanIssuanceEvent>
          | FindOptionsWhere<VirtualIbanIssuanceEvent>[]
          | undefined;
        if (where == null) return candidatePool;
        return candidatePool.filter((candidate) => entityMatchesWhere(candidate, where));
      });

      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(
          listingResult([listingEntry(mergeRetiredReference), listingEntry(phase1ReopenReference)], true),
        );

      await service.reconcileRetiredIssuanceReferences();

      // Unrelated event must not contribute an abandoned reference → no listing lookup under its ref.
      // (Listing is still called once for the bank; the orphan alert must not mention unrelated.)
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected',
          errors: expect.arrayContaining([
            expect.stringContaining(`abandonedReference=${mergeRetiredReference}`),
            expect.stringContaining(`abandonedReference=${phase1ReopenReference}`),
          ]),
        },
      });
      const matchCall = (notificationService.sendMail as jest.Mock).mock.calls.find(
        (c) => c[0].input.subject === 'Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected',
      );
      expect(matchCall[0].input.errors).toHaveLength(2);
      expect(matchCall[0].input.errors.join('\n')).not.toContain(unrelatedReference);
      expect(matchCall[0].input.errors.join('\n')).toContain('eventId=31');
      expect(matchCall[0].input.errors.join('\n')).toContain('eventId=32');
    });
  });

  describe('edge cases for full coverage', () => {
    it('alerts and continues when Phase 2 event nextError has a marker but empty reference value', async () => {
      // Productive-path reachable fixture: nextError contains CREATE_PATH_REFERENCE_MARKER so the
      // real WHERE nextError LIKE '%previousRequestReference=%' clause would return this row, but
      // the value after the marker is empty (marker immediately followed by ';') so extractAbandonedReference
      // cannot parse a reference → reason=reference_unextractable.
      const unextractableNextError = `${CREATE_PATH_REFERENCE_MARKER};newRequestReference=dfx-viban-irrelevant`;
      eventRepo.find.mockResolvedValue([
        event({
          id: 99,
          nextError: unextractableNextError,
        }),
      ]);

      await service.reconcileRetiredIssuanceReferences();

      // Zero resolvable abandoned references → Phase 2 must never reach Frick listing.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      // One alert for the single unextractable candidate.
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 2: abandoned-reference candidate(s) could not be resolved',
          errors: expect.arrayContaining([expect.stringContaining('eventId=99')]),
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors).toHaveLength(1);
      expect(mailArg.input.errors.join('\n')).toContain('reason=reference_unextractable');
      // No free-text nextError content in the alert (PII-safe identifiers only).
      expect(mailArg.input.errors.join('\n')).not.toContain(unextractableNextError);
      expect(mailArg.input.errors.join('\n')).not.toContain('newRequestReference=');
    });

    it('sends per-bank failure alert when bank has no IBAN configured and does not abort the whole run', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 200, requestReference: stuckRequestReference })]);
      jest.spyOn(bankService, 'getBankById').mockResolvedValue({ id: bankId, iban: null } as any);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN reconciliation Phase 1: processing failed for one or more banks',
          errors: [expect.stringContaining('Processing threw for 1 bank(s)')],
        },
      });
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).not.toContain('Frick vIBAN retired-reference reconciliation: check could not run');
    });

    it('sends outer Phase 1 failure alert when the intent query itself throws', async () => {
      intentRepo.find.mockRejectedValue(new Error('intent repository unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN retired-reference reconciliation: check could not run',
          errors: [expect.stringContaining('NOT evidence of a clean state')],
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors[0]).not.toContain('intent repository unavailable');
    });

    it('still runs Phase 2 when delivery of the Phase 1 failure alert rejects', async () => {
      intentRepo.find.mockRejectedValue(new Error('intent repository unavailable'));
      jest
        .spyOn(notificationService, 'sendMail')
        .mockRejectedValueOnce(new Error('monitoring mail unavailable'))
        .mockResolvedValue(undefined as any);
      const loggerError = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(eventRepo.find).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to deliver Frick vIBAN reconciliation Phase 1 failure alert:',
        expect.any(Error),
      );
    });

    it('sends outer Phase 2 failure alert when the abandoned-event query itself throws', async () => {
      eventRepo.find.mockRejectedValue(new Error('event repository unavailable'));

      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN retired-reference reconciliation: check could not run',
          errors: [expect.stringContaining('NOT evidence of a clean state')],
        },
      });
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors[0]).not.toContain('event repository unavailable');
    });

    it('sends outer Phase 2 failure alert when a LIKE-matched event has nextError=null (SQL invariant fail-closed)', async () => {
      // Productively unreachable via the Postgres LIKE query path (NULL LIKE pattern is never
      // true — see the invariant comment in loadAbandonedReferences ~line 422). This test only
      // covers the fail-closed reaction to a hypothetical future dialect/driver violation of that
      // SQL invariant: coverage completeness + the throw path itself. The mock bypasses SQL
      // filtering and injects a row that production Postgres cannot return from that query.
      const invariantBreakingEvent = Object.assign(event({ id: 426, nextError: 'not-used' }), {
        nextError: null,
      });
      eventRepo.find.mockResolvedValue([invariantBreakingEvent]);

      // Outer try/catch in reconcileRetiredIssuanceReferences absorbs the throw — must not rethrow.
      await expect(service.reconcileRetiredIssuanceReferences()).resolves.toBeUndefined();

      // Fail-closed throw aborts loadAbandonedReferences before any Frick listing work.
      expect(frickVibanProvider.listByReferenceAccount).not.toHaveBeenCalled();
      // Outer Phase-2 catch → sendFailureAlert — not sendUnresolvedAbandonedReferenceAlert
      // (that path only runs after the null check, for unextractable non-null nextError).
      expect(notificationService.sendMail).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN retired-reference reconciliation: check could not run',
          errors: [
            'The reconciliation check itself failed; absence of a match alert is NOT evidence of a clean state. See server logs for the classified failure reason.',
          ],
        },
      });
      const subjects = (notificationService.sendMail as jest.Mock).mock.calls.map((c) => c[0].input.subject);
      expect(subjects).not.toContain(
        'Frick vIBAN reconciliation Phase 2: abandoned-reference candidate(s) could not be resolved',
      );
      // Fixed alert text only — no free-form throw message / nextError / event PII.
      const mailArg = (notificationService.sendMail as jest.Mock).mock.calls[0][0];
      expect(mailArg.input.errors[0]).not.toContain('SQL invariant violated');
      expect(mailArg.input.errors[0]).not.toContain('event 426');
      expect(mailArg.input.errors[0]).not.toContain('nextError');
    });

    it('reuses the Phase-1 listing cache in Phase 2 for the same bankId', async () => {
      // Same bankId in both phases → getListingForBank returns the cached result on the second call.
      intentRepo.find.mockResolvedValue([intent({ id: 202, requestReference: stuckRequestReference })]);
      eventRepo.find.mockResolvedValue([
        event({
          nextError: `create failed; recovery listing found no match; previousRequestReference=${abandonedCreate}; newRequestReference=dfx-viban-new`,
        }),
      ]);
      jest
        .spyOn(frickVibanProvider, 'listByReferenceAccount')
        .mockResolvedValue(listingResult([listingEntry('dfx-viban-unrelated')], true));

      await service.reconcileRetiredIssuanceReferences();

      expect(frickVibanProvider.listByReferenceAccount).toHaveBeenCalledTimes(1);
      expect(bankService.getBankById).toHaveBeenCalledTimes(1);
    });

    it('does not count a concurrent no-op reset as a successful reset', async () => {
      intentRepo.find.mockResolvedValue([intent({ id: 201, requestReference: stuckRequestReference })]);
      jest.spyOn(frickVibanProvider, 'listByReferenceAccount').mockResolvedValue(listingResult([], true));
      jest.spyOn(virtualIbanService, 'resetStuckFrickIntentForReconciliationOnly').mockResolvedValue(false);

      await service.reconcileRetiredIssuanceReferences();

      expect(virtualIbanService.resetStuckFrickIntentForReconciliationOnly).toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('extracts marker value when there is no trailing semicolon', () => {
      expect(service.extractAbandonedReference(`previousRequestReference=${abandonedCreate}`)).toBe(abandonedCreate);
      expect(
        service.extractAbandonedReference(
          `recovery listing found no match under requestReference=${abandonedRecovery}`,
        ),
      ).toBe(abandonedRecovery);
    });

    it('returns undefined when marker values are empty', () => {
      expect(service.extractAbandonedReference('previousRequestReference=; trailing')).toBeUndefined();
      expect(
        service.extractAbandonedReference('recovery listing found no match under requestReference=; trailing'),
      ).toBeUndefined();
      expect(service.extractAbandonedReference('no markers here')).toBeUndefined();
    });

    it('extracts requestReference from a merge-supersede nextError message shape', () => {
      // Shape produced by resolveIssuanceIntentsForMergeLocked / failFrickIntentLocked —
      // parser coverage only; the where-clause path is covered by the Phase-2 query-level test.
      const mergeRetiredReference = 'dfx-viban-mergesuperseded000000000001';
      const nextError =
        `Superseded by account merge of userData 2000 into 1000; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${mergeRetiredReference}`;

      expect(service.extractAbandonedReference(nextError)).toBe(mergeRetiredReference);
    });
  });
});
