import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Asset } from './asset.entity';

@Injectable()
export class AssetRepository extends BaseRepository<Asset> {
  constructor(manager: EntityManager) {
    super(Asset, manager);
  }
}
