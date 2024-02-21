import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';

@Injectable()
export class TransactionSpecificationRepository extends BaseRepository<TransactionSpecification> {
  constructor(manager: EntityManager) {
    super(TransactionSpecification, manager);
  }

  getProps(param: Asset | Fiat): { system: string; asset: string } {
    return param instanceof Fiat
      ? { system: 'Fiat', asset: param.name }
      : { system: param.blockchain, asset: param.dexName };
  }

  getSpecFor(
    specs: TransactionSpecification[],
    param: Asset | Fiat,
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
