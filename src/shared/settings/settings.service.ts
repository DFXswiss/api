import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  async get(key: string): Promise<string> {
    const settingsData = await this.settingsRepo.findOne({ key: key });
    return settingsData?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.settingsRepo.save({ key, value });
  }
}
