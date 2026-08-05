import { createMock } from '@golevelup/ts-jest';
import { FindManyOptions } from 'typeorm';
import { FileSubType } from '../../dto/kyc-file.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycFileRepository } from '../../repositories/kyc-file.repository';
import { KycFileService } from '../kyc-file.service';

// The answer decides whether an ident step may advance without its documents being fetched, so both
// halves of the question are load-bearing: the step it asks about, and the validity of what it finds.
describe('KycFileService hasValidIdentReport', () => {
  let service: KycFileService;
  let kycFileRepo: jest.Mocked<KycFileRepository>;

  const kycStepId = 7;

  // Stands in for the stored rows: answers the query the service actually sent, so a dropped filter
  // shows up as a wrong answer rather than only as a differently shaped call.
  function storedReports(reports: Partial<KycFile>[]): void {
    (kycFileRepo.exists as jest.Mock).mockImplementation(({ where }: FindManyOptions<KycFile>) => {
      const w = where as { kycStep?: { id: number }; subType?: FileSubType; valid?: boolean };

      return Promise.resolve(
        reports.some(
          (r) =>
            (w.kycStep == null || r.kycStep?.id === w.kycStep.id) &&
            (w.subType == null || r.subType === w.subType) &&
            (w.valid == null || r.valid === w.valid),
        ),
      );
    });
  }

  beforeEach(() => {
    kycFileRepo = createMock<KycFileRepository>();
    service = new KycFileService(kycFileRepo);
  });

  // The retry net exists for exactly this run: a rejected attempt left its documents on the step as
  // invalid, the user passed afterwards, and the download of the documents that count failed.
  it('does not accept an invalidated report of a rejected attempt', async () => {
    storedReports([
      { kycStep: { id: kycStepId } as KycFile['kycStep'], subType: FileSubType.IDENT_REPORT, valid: false },
    ]);

    await expect(service.hasValidIdentReport(kycStepId)).resolves.toBe(false);
  });

  it('accepts a valid report of that step', async () => {
    storedReports([
      { kycStep: { id: kycStepId } as KycFile['kycStep'], subType: FileSubType.IDENT_REPORT, valid: true },
    ]);

    await expect(service.hasValidIdentReport(kycStepId)).resolves.toBe(true);
  });

  // The account-wide question this replaced: another step's report says nothing about this one.
  it('ignores a valid report belonging to another step', async () => {
    storedReports([
      { kycStep: { id: kycStepId + 1 } as KycFile['kycStep'], subType: FileSubType.IDENT_REPORT, valid: true },
    ]);

    await expect(service.hasValidIdentReport(kycStepId)).resolves.toBe(false);
  });

  it('ignores another document type of that step', async () => {
    storedReports([
      { kycStep: { id: kycStepId } as KycFile['kycStep'], subType: FileSubType.IDENT_SELFIE, valid: true },
    ]);

    await expect(service.hasValidIdentReport(kycStepId)).resolves.toBe(false);
  });
});
