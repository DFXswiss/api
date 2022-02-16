import { EntityRepository, Repository } from 'typeorm';
import { Language } from './language.entity';

@EntityRepository(Language)
export class LanguageRepository extends Repository<Language> {}
