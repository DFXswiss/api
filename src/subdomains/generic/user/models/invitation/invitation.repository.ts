import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Invitation } from './invitation.entity';

@Injectable()
export class InvitationRepository extends BaseRepository<Invitation> {
  constructor(manager: EntityManager) {
    super(Invitation, manager);
  }
}
