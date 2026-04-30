import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Asset } from './asset.entity';

@Injectable()
export class AssetRepository extends CachedRepository<Asset> {
  constructor(manager: EntityManager) {
    super(Asset, manager);
  }
}
