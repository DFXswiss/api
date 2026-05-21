import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { CompanyInfo } from './company-info.entity';

@Injectable()
export class CompanyInfoRepository extends CachedRepository<CompanyInfo> {
  constructor(manager: EntityManager) {
    super(CompanyInfo, manager);
  }
}
