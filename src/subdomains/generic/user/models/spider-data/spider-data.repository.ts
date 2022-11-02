import { EntityRepository, Repository } from 'typeorm';
import { SpiderData } from './spider-data.entity';

@EntityRepository(SpiderData)
export class SpiderDataRepository extends Repository<SpiderData> {}
