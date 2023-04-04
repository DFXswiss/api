import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { AssetPricingMetadata } from '../domain/entities/asset-pricing-metadata.entity';

@Injectable()
export class AssetPricingMetadataRepository extends BaseRepository<AssetPricingMetadata> {
  constructor(manager: EntityManager) {
    super(AssetPricingMetadata, manager);
  }
}
