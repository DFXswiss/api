import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { C2BPaymentOrder } from '../entities/c2b-order.entity';

@Injectable()
export class C2BPaymentOrderRepository extends BaseRepository<C2BPaymentOrder> {
    constructor(manager: EntityManager) {
        super(C2BPaymentOrder, manager);
    }
} 