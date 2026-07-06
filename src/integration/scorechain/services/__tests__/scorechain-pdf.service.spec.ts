import { ScorechainAnalysisType, ScorechainObjectType } from '../../dto/scorechain.dto';
import {
  ScorechainScreening,
  ScorechainScreeningContext,
  ScorechainScreeningTriggerType,
} from '../../entities/scorechain-screening.entity';
import { ScorechainPdfService } from '../scorechain-pdf.service';

describe('ScorechainPdfService', () => {
  let service: ScorechainPdfService;

  beforeEach(() => {
    service = new ScorechainPdfService();
  });

  function createScreening(overrides: Partial<ScorechainScreening> = {}): ScorechainScreening {
    return Object.assign(new ScorechainScreening(), {
      id: 1,
      objectType: ScorechainObjectType.ADDRESS,
      objectId: '0xabc',
      blockchain: 'Ethereum',
      analysisType: ScorechainAnalysisType.OUTGOING,
      context: ScorechainScreeningContext.WITHDRAWAL,
      triggerType: ScorechainScreeningTriggerType.MANUAL,
      riskScore: 85,
      severity: 'LOW_RISK',
      signatureValid: true,
      ...overrides,
    });
  }

  const isPdf = (buffer: Buffer): boolean => buffer.subarray(0, 4).toString('ascii') === '%PDF';

  it('renders a PDF buffer for a screening with a risk-indicator breakdown', async () => {
    const screening = createScreening();
    screening.riskIndicatorData = {
      outgoing: {
        hasResult: true,
        result: {
          score: 85,
          severity: 'LOW_RISK',
          details: [
            {
              name: 'Exchange A',
              type: 'EXCHANGE',
              countries: ['US'],
              percentage: 42.5,
              amountUsd: 12345.67,
              score: 20,
              severity: 'HIGH_RISK',
            },
            {
              name: 'Mixer B',
              type: 'MIXER',
              countries: [],
              percentage: 5,
              amountUsd: 100,
              score: 5,
              severity: 'CRITICAL_RISK',
            },
          ],
        },
      },
    };

    const buffer = await service.generate(screening);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(isPdf(buffer)).toBe(true);
  });

  it('renders a PDF buffer with a note when there is no breakdown (no coverage)', async () => {
    const screening = createScreening({ riskScore: undefined, severity: 'NoCoverage', signatureValid: true });

    const buffer = await service.generate(screening);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(isPdf(buffer)).toBe(true);
  });

  it('renders a PDF buffer for a not-found screening (no indicators, invalid signature)', async () => {
    const screening = createScreening({ riskScore: undefined, severity: 'NotFound', signatureValid: false });

    const buffer = await service.generate(screening);

    expect(isPdf(buffer)).toBe(true);
  });
});
