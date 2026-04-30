import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Language } from './language.entity';

@Injectable()
export class LanguageRepository extends CachedRepository<Language> {
  constructor(manager: EntityManager) {
    super(Language, manager);
  }
}
