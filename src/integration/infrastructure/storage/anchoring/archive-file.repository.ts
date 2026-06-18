import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { ArchiveFile } from './archive-file.entity';

@Injectable()
export class ArchiveFileRepository extends BaseRepository<ArchiveFile> {
  constructor(manager: EntityManager) {
    super(ArchiveFile, manager);
  }
}
