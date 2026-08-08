import { IdentType } from '../../dto/ident-result-data.dto';
import { KycStepType } from '../../enums/kyc.enum';
import { KycStep } from '../kyc-step.entity';

describe('KycStep resultData', () => {
  const sumsubStep = (result: object): KycStep =>
    Object.assign(new KycStep(), {
      type: KycStepType.SUMSUB_AUTO,
      result: JSON.stringify(result),
    });

  it('does not throw when a Sumsub step holds a manual-shaped result', () => {
    const step = sumsubStep({
      firstName: 'A',
      lastName: 'B',
      birthday: '2000-01-01',
      nationality: { id: 1, symbol: 'DE' },
      documentType: 'PASSPORT',
      documentNumber: 'X1',
      documentUrl: 'https://example.com/f.pdf',
    });

    expect(() => step.resultData).not.toThrow();
    expect(step.resultData.type).toBe(IdentType.SUM_SUB);
    expect(step.resultData.success).toBe(false);
  });

  it('maps a well-formed Sumsub result as before', () => {
    const step = sumsubStep({
      webhook: { levelName: 'L', reviewResult: { reviewAnswer: 'GREEN' } },
      data: {
        info: {
          idDocs: [
            {
              firstName: 'A',
              firstNameEn: 'A',
              lastNameEn: 'B',
              dob: '2000-01-01',
              country: 'DEU',
              number: 'X1',
              idDocType: 'PASSPORT',
            },
          ],
        },
        ipCountry: 'DEU',
      },
    });

    expect(step.resultData.firstname).toBe('A');
    expect(step.resultData.lastname).toBe('B');
    expect(step.resultData.success).toBe(true);
  });
});
