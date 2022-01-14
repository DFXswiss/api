import { EntityRepository, Repository } from 'typeorm';
import { Setting } from './setting.entity';

@EntityRepository(Setting)
export class SettingRepository extends Repository<Setting> {}
