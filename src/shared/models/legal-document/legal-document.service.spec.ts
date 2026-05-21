import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { LegalDocument, LegalDocumentType } from './legal-document.entity';
import { LegalDocumentRepository } from './legal-document.repository';
import { LegalDocumentService } from './legal-document.service';

const buildDoc = (overrides: Partial<LegalDocument> = {}): LegalDocument =>
  Object.assign(new LegalDocument(), {
    id: 1,
    type: LegalDocumentType.REGISTRATION_AGREEMENT,
    language: 'de',
    version: '1.0',
    url: 'https://example.com/de.pdf',
    enabled: true,
    ...overrides,
  });

describe('LegalDocumentService', () => {
  let service: LegalDocumentService;
  let repo: jest.Mocked<LegalDocumentRepository>;

  beforeEach(async () => {
    repo = createMock<LegalDocumentRepository>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [LegalDocumentService, { provide: LegalDocumentRepository, useValue: repo }],
    }).compile();
    service = module.get<LegalDocumentService>(LegalDocumentService);
  });

  it('returns every enabled document when no filters are given', async () => {
    const docs = [buildDoc(), buildDoc({ id: 2, language: 'en', url: 'https://example.com/en.pdf' })];
    repo.findCachedBy.mockResolvedValueOnce(docs);

    const result = await service.getDocuments();

    expect(result).toEqual(docs);
    expect(repo.findCachedBy).toHaveBeenCalledWith('enabled:*:*', { enabled: true });
  });

  it('passes the type filter through to the repository', async () => {
    repo.findCachedBy.mockResolvedValueOnce([]);

    await service.getDocuments({ type: LegalDocumentType.PROSPECTUS });

    expect(repo.findCachedBy).toHaveBeenCalledWith('enabled:Prospectus:*', {
      enabled: true,
      type: LegalDocumentType.PROSPECTUS,
    });
  });

  it('filters by language case-insensitively after the repo call', async () => {
    const docs = [
      buildDoc({ id: 1, language: 'de' }),
      buildDoc({ id: 2, language: 'en' }),
      buildDoc({ id: 3, language: null }), // language-agnostic, always included
    ];
    repo.findCachedBy.mockResolvedValueOnce(docs);

    const result = await service.getDocuments({ language: 'DE' });

    expect(result.map((d) => d.id)).toEqual([1, 3]);
  });

  it('returns no documents when the repository has none', async () => {
    repo.findCachedBy.mockResolvedValueOnce([]);

    const result = await service.getDocuments({ type: LegalDocumentType.DFX_TERMS, language: 'de' });

    expect(result).toEqual([]);
  });
});
