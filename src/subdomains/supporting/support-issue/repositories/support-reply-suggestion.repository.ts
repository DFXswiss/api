import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportReplySuggestion } from '../entities/support-reply-suggestion.entity';

@Injectable()
export class SupportReplySuggestionRepository extends BaseRepository<SupportReplySuggestion> {
  constructor(manager: EntityManager) {
    super(SupportReplySuggestion, manager);
  }
}
