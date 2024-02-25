import { Injectable } from '@nestjs/common';
import { Active, isAsset } from 'src/shared/models/active';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';

@Injectable()
export class TransactionSpecificationRepository extends BaseRepository<TransactionSpecification> {
  constructor(manager: EntityManager) {
    super(TransactionSpecification, manager);
  }

  getProps(param: Active): { system: string; asset: string } {
    return isAsset(param) ? { system: param.blockchain, asset: param.dexName } : { system: 'Fiat', asset: param.name };
  }

  getSpecFor(
    specs: TransactionSpecification[],
    param: Active,
    direction: TransactionDirection,
  ): TransactionSpecification {
    const { system, asset } = this.getProps(param);
    return this.getSpec(specs, system, asset, direction);
  }

  getSpec(
    specs: TransactionSpecification[],
    system: string,
    asset: string,
    direction: TransactionDirection,
  ): TransactionSpecification {
    return (
      this.findSpec(specs, system, asset, direction) ??
      this.findSpec(specs, system, undefined, direction) ??
      this.findSpec(specs, system, asset, undefined) ??
      this.findSpec(specs, system, undefined, undefined) ??
      TransactionSpecification.default()
    );
  }

  private findSpec(
    specs: TransactionSpecification[],
    system: string,
    asset: string | undefined,
    direction: TransactionDirection | undefined,
  ): TransactionSpecification | undefined {
    return specs.find((t) => t.system == system && t.asset == asset && t.direction == direction);
  }
}
