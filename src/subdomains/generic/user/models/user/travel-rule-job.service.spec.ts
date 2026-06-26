import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { TravelRuleJobService } from './travel-rule-job.service';
import { TravelRulePdfService } from './travel-rule-pdf.service';
import { UserRepository } from './user.repository';

describe('TravelRuleJobService', () => {
  let service: TravelRuleJobService;

  let userRepo: UserRepository;
  let travelRulePdfService: TravelRulePdfService;
  let kycDocumentService: KycDocumentService;
  let kycFileService: KycFileService;

  // a valid EVM signature (0x + 130 hex) so the fail-closed format check passes by default
  const validSignature = `0x${'a'.repeat(130)}`;

  function createUser(id: number, signature: string = validSignature): any {
    return { id, address: `addr-${id}`, signature, userData: { id: id * 10 } };
  }

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    travelRulePdfService = createMock<TravelRulePdfService>();
    kycDocumentService = createMock<KycDocumentService>();
    kycFileService = createMock<KycFileService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TravelRuleJobService,
        { provide: UserRepository, useValue: userRepo },
        { provide: TravelRulePdfService, useValue: travelRulePdfService },
        { provide: KycDocumentService, useValue: kycDocumentService },
        { provide: KycFileService, useValue: kycFileService },
      ],
    }).compile();

    service = module.get<TravelRuleJobService>(TravelRuleJobService);

    jest.spyOn(travelRulePdfService, 'generatePdf').mockResolvedValue('cGRm'); // "pdf"
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockResolvedValue({ file: { id: 1 } as any, url: 'url' });
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    // default: the idempotency lookup finds no existing file, so candidates are generated as before
    jest.spyOn(kycFileService, 'getUserDataKycFiles').mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('queries only signed, not-yet-rendered, kyc>=40, non-custody candidates ordered by id', async () => {
    const findSpy = jest.spyOn(userRepo, 'find').mockResolvedValue([]);

    await service.generateTravelRulePdfs();

    expect(findSpy).toHaveBeenCalledWith({
      where: {
        signature: Not(IsNull()),
        travelRulePdfDate: IsNull(),
        userData: { kycLevel: MoreThanOrEqual(KycLevel.LEVEL_40) },
        custodyProvider: IsNull(),
      },
      relations: { userData: true },
      order: { id: 'ASC' },
      take: 100,
    });
  });

  it('claim-first: processes a candidate and uploads exactly one file when the CAS succeeds', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);

    await service.generateTravelRulePdfs();

    // first update is the CAS claim: criteria carries the IS-NULL guard, partial sets the date
    const claimCall = (userRepo.update as jest.Mock).mock.calls[0];
    expect(claimCall[0]).toEqual({ id: 7, travelRulePdfDate: IsNull() });
    expect(claimCall[1]).toEqual({ travelRulePdfDate: expect.any(Date) });
    expect(kycDocumentService.uploadUserFile).toHaveBeenCalledTimes(1);

    const args = (kycDocumentService.uploadUserFile as jest.Mock).mock.calls[0];
    expect(args[1]).toBe(FileType.USER_NOTES);
    expect(args[4]).toBe(ContentType.PDF);
    expect(args[7]).toBe(FileSubType.ADDRESS_SIGNATURE);
  });

  it('skips processing when the CAS claim is lost (affected === 0)', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 0 } as any);

    await service.generateTravelRulePdfs();

    expect(travelRulePdfService.generatePdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rolls back travelRulePdfDate and invalidates the orphan file on upload failure', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockRejectedValue(new Error('storage down'));
    jest.spyOn(kycFileService, 'getUserDataKycFiles').mockResolvedValue([{ id: 99, name: 'ignored' } as any]);
    const invalidateSpy = jest.spyOn(kycFileService, 'invalidateKycFile').mockResolvedValue();

    await service.generateTravelRulePdfs();

    // the rollback update resets the date to null
    const rollback = (userRepo.update as jest.Mock).mock.calls.find(
      ([, partial]) => partial.travelRulePdfDate === null,
    );
    expect(rollback).toBeDefined();
    expect(rollback[0]).toEqual({ id: 7 });

    // orphan lookup runs against the candidate's userData; the listed row name does not match the
    // generated file name here, so nothing is invalidated (the name-matching case is covered below)
    expect(kycFileService.getUserDataKycFiles).toHaveBeenCalledWith(70);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the matching orphan row when its name equals the generated file name', async () => {
    const captured: string[] = [];
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockImplementation(async (_ud, _t, name: string) => {
      captured.push(name);
      throw new Error('storage down');
    });
    const invalidateSpy = jest.spyOn(kycFileService, 'invalidateKycFile').mockResolvedValue();
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockImplementation(async () => [{ id: 99, name: captured[0] } as any]);

    await service.generateTravelRulePdfs();

    expect(invalidateSpy).toHaveBeenCalledWith(99);
  });

  it('logs an error (claim leak) when the rollback update itself fails after an upload failure', async () => {
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockRejectedValue(new Error('storage down'));
    // claim succeeds, but the rollback update (travelRulePdfDate → null) rejects → claim stays leaked
    const rollbackError = new Error('db down');
    jest
      .spyOn(userRepo, 'update')
      .mockResolvedValueOnce({ affected: 1 } as any) // CAS claim
      .mockRejectedValueOnce(rollbackError); // rollback
    jest.spyOn(kycFileService, 'getUserDataKycFiles').mockResolvedValue([]);

    await service.generateTravelRulePdfs();

    expect(errorSpy).toHaveBeenCalledWith('TravelRule PDF claim rollback failed for user 7', rollbackError);
  });

  it('logs an error when invalidating the matching orphan file fails', async () => {
    const captured: string[] = [];
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockImplementation(async (_ud, _t, name: string) => {
      captured.push(name);
      throw new Error('storage down');
    });
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockImplementation(async () => [{ id: 99, name: captured[0] } as any]);
    const invalidationError = new Error('invalidate failed');
    jest.spyOn(kycFileService, 'invalidateKycFile').mockRejectedValue(invalidationError);

    await service.generateTravelRulePdfs();

    expect(errorSpy).toHaveBeenCalledWith('TravelRule PDF orphan invalidation failed for file 99', invalidationError);
  });

  it('builds a distinct originalName per user whose date segment equals YYYYMMDD', async () => {
    const names: string[] = [];
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7), createUser(8)]);
    jest.spyOn(userRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockImplementation(async (_ud, _t, name: string) => {
      names.push(name);
      return { file: { id: 1 } as any, url: 'url' };
    });

    await service.generateTravelRulePdfs();

    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // distinct (different user id in the name)

    const yyyymmdd = new Date().toISOString().split('T')[0].replace(/-/g, '');
    for (const name of names) {
      expect(name.split('-')[0]).toBe(yyyymmdd); // config id-15 download sort relies on this
      expect(name).toMatch(/^\d{8}-AddressSignature-0-\d+-\d{6}\.pdf$/);
    }
    expect(names[0]).toContain('-0-7-');
    expect(names[1]).toContain('-0-8-');
  });

  it('skips a candidate whose signature is a UUID (no cryptographic ownership proof)', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7, '00000000-0000-4000-8000-000000000000')]);

    await service.generateTravelRulePdfs();

    // never claimed, never rendered, never uploaded — and travelRulePdfDate stays untouched
    expect(userRepo.update).not.toHaveBeenCalled();
    expect(travelRulePdfService.generatePdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('skips a candidate whose signature is an unrecognised artefact (e.g. "Link")', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7, 'Link')]);

    await service.generateTravelRulePdfs();

    expect(userRepo.update).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('processes candidates across all allowlisted signature formats', async () => {
    const evm = `0x${'a'.repeat(130)}`;
    const evmLong = `0x${'b'.repeat(146)}`;
    const bitcoin = `H${'A'.repeat(87)}=`; // base64-ish, 65-byte recoverable signature
    const monero = '4'.repeat(95); // long base58 (no 0/O/I/l)
    const cardano = '8458200a;a4010103272006215820deadbeef'; // CIP-30 COSE with ;<key> suffix

    const users = [evm, evmLong, bitcoin, monero, cardano].map((sig, i) => createUser(i + 1, sig));
    jest.spyOn(userRepo, 'find').mockResolvedValue(users);

    await service.generateTravelRulePdfs();

    // every allowlisted format is rendered and uploaded
    expect(kycDocumentService.uploadUserFile).toHaveBeenCalledTimes(users.length);
    // the Cardano signature is passed verbatim (incl. ;<key>) to the PDF renderer, together with the
    // candidate's id / userData.id / address and the generation timestamp
    expect(travelRulePdfService.generatePdf).toHaveBeenCalledWith({
      id: 5,
      userDataId: 50,
      address: 'addr-5',
      signature: cardano,
      date: expect.any(Date),
    });
  });

  // *** IDEMPOTENCY: reuse an existing AddressSignature PDF instead of generating a duplicate *** //

  function addressSignatureFile(id: number, name: string, overrides: Partial<any> = {}): any {
    return { id, name, valid: true, subType: FileSubType.ADDRESS_SIGNATURE, ...overrides };
  }

  it('stamps the date from an existing valid PDF and skips generation entirely', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockResolvedValue([addressSignatureFile(99, '20260603-AddressSignature-0-7-120000.pdf')]);

    await service.generateTravelRulePdfs();

    // CAS stamp carries the IS-NULL guard and the date parsed from the file name (2026-06-03 UTC)
    const stampCall = (userRepo.update as jest.Mock).mock.calls[0];
    expect(stampCall[0]).toEqual({ id: 7, travelRulePdfDate: IsNull() });
    expect(stampCall[1].travelRulePdfDate).toEqual(new Date(Date.UTC(2026, 5, 3)));
    expect((stampCall[1].travelRulePdfDate as Date).toISOString()).toBe('2026-06-03T00:00:00.000Z');

    // no regeneration, no upload — the existing PDF is reused as-is
    expect(travelRulePdfService.generatePdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('generates normally when no existing PDF is present', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest.spyOn(kycFileService, 'getUserDataKycFiles').mockResolvedValue([]);

    await service.generateTravelRulePdfs();

    // claim-first CAS with now, then generate + upload exactly like before the idempotency change
    const claimCall = (userRepo.update as jest.Mock).mock.calls[0];
    expect(claimCall[0]).toEqual({ id: 7, travelRulePdfDate: IsNull() });
    expect(claimCall[1]).toEqual({ travelRulePdfDate: expect.any(Date) });
    expect(travelRulePdfService.generatePdf).toHaveBeenCalledTimes(1);
    expect(kycDocumentService.uploadUserFile).toHaveBeenCalledTimes(1);
  });

  it('multi-address guard: only this user.id matches, a sibling user PDF in the same userData does not', async () => {
    // user 7 shares userData with user 70; only user 70's PDF exists → user 7 must generate, the
    // trailing hyphen in the infix prevents `-0-7-` from matching the `-0-70-` file name
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockResolvedValue([addressSignatureFile(99, '20260603-AddressSignature-0-70-120000.pdf')]);

    await service.generateTravelRulePdfs();

    expect(travelRulePdfService.generatePdf).toHaveBeenCalledTimes(1);
    expect(kycDocumentService.uploadUserFile).toHaveBeenCalledTimes(1);
    // no stamp from a foreign date — the only update is the claim with a fresh now date
    const stampWithParsedDate = (userRepo.update as jest.Mock).mock.calls.find(
      ([criteria, partial]) =>
        criteria.travelRulePdfDate instanceof Object &&
        (partial.travelRulePdfDate as Date)?.toISOString?.() === '2026-06-03T00:00:00.000Z',
    );
    expect(stampWithParsedDate).toBeUndefined();
  });

  it('fail-safe: a malformed existing file name is logged as error and never stamped or generated', async () => {
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockResolvedValue([addressSignatureFile(99, 'AddressSignature-0-7-120000.pdf')]); // no YYYYMMDD prefix

    await service.generateTravelRulePdfs();

    // never stamped (no guessed date), never generated, never uploaded
    expect(userRepo.update).not.toHaveBeenCalled();
    expect(travelRulePdfService.generatePdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('malformed name'));
  });

  it('fail-safe: an existing file name with an impossible date (rollover) is rejected, never stamped', async () => {
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockResolvedValue([addressSignatureFile(99, '20261332-AddressSignature-0-7-120000.pdf')]); // month 13, day 32

    await service.generateTravelRulePdfs();

    // the 8-digit prefix parses but is an impossible calendar date → undefined → fail-safe, no guess
    expect(userRepo.update).not.toHaveBeenCalled();
    expect(travelRulePdfService.generatePdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('malformed name'));
  });

  it('an invalid (valid:false) existing PDF does not count as present → generates normally', async () => {
    jest.spyOn(userRepo, 'find').mockResolvedValue([createUser(7)]);
    jest
      .spyOn(kycFileService, 'getUserDataKycFiles')
      .mockResolvedValue([addressSignatureFile(99, '20260603-AddressSignature-0-7-120000.pdf', { valid: false })]);

    await service.generateTravelRulePdfs();

    expect(travelRulePdfService.generatePdf).toHaveBeenCalledTimes(1);
    expect(kycDocumentService.uploadUserFile).toHaveBeenCalledTimes(1);
  });
});
