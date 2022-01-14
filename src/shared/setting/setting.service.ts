import { Injectable } from '@nestjs/common';
import { SettingRepository } from './setting.repository';

@Injectable()
export class SettingService {
  constructor(private readonly settingRepo: SettingRepository) {}

  async get(key: string): Promise<string | undefined> {
    return this.settingRepo.findOne({ key: key }).then((d) => d?.value);
  }

  async set(key: string, value: string): Promise<void> {
    await this.settingRepo.save({ key, value });
  }
}
