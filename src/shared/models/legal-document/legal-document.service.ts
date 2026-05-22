import { Injectable } from '@nestjs/common';
import { LegalDocument, LegalDocumentType } from './legal-document.entity';
import { LegalDocumentRepository } from './legal-document.repository';

@Injectable()
export class LegalDocumentService {
  constructor(private readonly repo: LegalDocumentRepository) {}

  // Returns every enabled document, optionally filtered by type / language.
  // The cache key encodes both so repeated identical queries share the
  // cached result.
  async getDocuments(filters: { type?: LegalDocumentType; language?: string } = {}): Promise<LegalDocument[]> {
    const cacheKey = `enabled:${filters.type ?? '*'}:${filters.language ?? '*'}`;
    const where: Partial<LegalDocument> = { enabled: true };
    if (filters.type) where.type = filters.type;

    const documents = await this.repo.findCachedBy(cacheKey, where);

    // Language filter is applied in-memory because the underlying
    // `findCachedBy` keys on the where-object exactly. Documents with
    // `language: null` are language-agnostic and match every query.
    if (!filters.language) return documents;
    const normalized = filters.language.toLowerCase();
    return documents.filter((d) => d.language == null || d.language.toLowerCase() === normalized);
  }
}
