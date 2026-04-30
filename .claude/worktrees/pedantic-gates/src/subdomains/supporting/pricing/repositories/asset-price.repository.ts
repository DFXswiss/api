import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { AssetPrice } from '../domain/entities/asset-price.entity';

@Injectable()
export class AssetPriceRepository extends BaseRepository<AssetPrice> {
  constructor(manager: EntityManager) {
    super(AssetPrice, manager);
  }
}
