import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { LegalDocument } from './legal-document.entity';

@Injectable()
export class LegalDocumentRepository extends CachedRepository<LegalDocument> {
  constructor(manager: EntityManager) {
    super(LegalDocument, manager);
  }
}
