import { Injectable } from '@nestjs/common';
import { CakeFlow, CakeFlowDto } from './dto/cake-flow.dto';
import { Setting } from './setting.entity';
import { SettingRepository } from './setting.repository';

@Injectable()
export class SettingService {
  constructor(private readonly settingRepo: SettingRepository) {}

  async getAll(): Promise<Setting[]> {
    return this.settingRepo.find();
  }

  async getCakeFlow(): Promise<CakeFlow> {
    const t = await this.settingRepo.findOne({ key: 'CakeFlow' });
    return t ? (JSON.parse(t.value) as CakeFlow) : undefined;
  }

  async get(key: string, defaultValue?: string): Promise<string | undefined> {
    return this.settingRepo.findOne({ key: key }).then((d) => d?.value ?? defaultValue);
  }

  async set(key: string, value: string): Promise<void> {
    await this.settingRepo.save({ key, value });
  }

  async setCakeFlow(dto: CakeFlowDto): Promise<void> {
    let currentCakeFlow = await this.getCakeFlow();
    currentCakeFlow ??= { assets: {} };

    currentCakeFlow.assets[dto.asset] = { direction: dto.direction, threshold: dto.threshold };

    await this.settingRepo.save({ key: 'CakeFlow', value: JSON.stringify(currentCakeFlow) });
  }

  async getObj<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.settingRepo.findOne({ key: key }).then((d) => (d?.value ? JSON.parse(d?.value) : defaultValue));
  }

  async setObj<T>(key: string, value: T): Promise<void> {
    await this.settingRepo.save({ key, value: JSON.stringify(value) });
  }
}
