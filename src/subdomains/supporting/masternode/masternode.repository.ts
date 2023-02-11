import { EntityRepository, Repository } from 'typeorm';
import { Masternode } from './masternode.entity';

@EntityRepository(Masternode)
export class MasternodeRepository extends Repository<Masternode> {}
