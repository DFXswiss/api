import { Test, TestingModule } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { TravelRulePdfService } from './travel-rule-pdf.service';

describe('TravelRulePdfService', () => {
  let service: TravelRulePdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TravelRulePdfService, TestUtil.provideConfig()],
    }).compile();

    service = module.get<TravelRulePdfService>(TravelRulePdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('renders a valid base64-encoded PDF', async () => {
    const base64 = await service.generateAddressSignaturePdf('0xabc', 'deadbeef');

    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const buffer = Buffer.from(base64, 'base64');
    // re-encoding is loss-less for valid base64
    expect(buffer.toString('base64')).toBe(base64);
    // a PDF stream starts with the "%PDF" magic bytes
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('strips the ;<key> suffix from the raw signature', () => {
    expect(service['rawSignature']('signaturePart;keyPart')).toBe('signaturePart');
  });

  it('keeps a signature without a ;<key> suffix unchanged', () => {
    expect(service['rawSignature']('signatureOnly')).toBe('signatureOnly');
  });
});
