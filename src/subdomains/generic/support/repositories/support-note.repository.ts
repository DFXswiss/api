import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportNote } from '../entities/support-note.entity';

@Injectable()
export class SupportNoteRepository extends BaseRepository<SupportNote> {
  constructor(manager: EntityManager) {
    super(SupportNote, manager);
  }
}
