import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { WalletApp } from '../entities/wallet-app.entity';

@Injectable()
export class WalletAppRepository extends CachedRepository<WalletApp> {
  constructor(manager: EntityManager) {
    super(WalletApp, manager);
  }
}
