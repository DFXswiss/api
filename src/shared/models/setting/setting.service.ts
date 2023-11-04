import { Injectable } from '@nestjs/common';
import { CakeFlowDto, CakeSettings } from './dto/cake-flow.dto';
import { CustomSignUpFees, UpdateCustomSignUpFeesDto } from './dto/custom-sign-up-fees.dto';
import { Setting } from './setting.entity';
import { SettingRepository } from './setting.repository';

@Injectable()
export class SettingService {
  constructor(private readonly settingRepo: SettingRepository) {}

  async getAll(): Promise<Setting[]> {
    return this.settingRepo.find();
  }

  async get(key: string, defaultValue?: string): Promise<string | undefined> {
    return this.settingRepo.findOneBy({ key }).then((d) => d?.value ?? defaultValue);
  }

  async set(key: string, value: string): Promise<void> {
    await this.settingRepo.save({ key, value });
  }

  async setCakeFlow(dto: CakeFlowDto): Promise<void> {
    const cakeSettings = await this.getObj<CakeSettings>('cake', { assets: {} });

    cakeSettings.assets[dto.asset] = { direction: dto.direction, threshold: dto.threshold };

    await this.setObj<CakeSettings>('cake', cakeSettings);
  }

  async updateCustomSignUpFees(dto: UpdateCustomSignUpFeesDto): Promise<void> {
    const customSignUpFeesArray = await this.getObj<CustomSignUpFees[]>('customSignUpFees');

    const customSignUpFee = customSignUpFeesArray.find((customSignUpFee) => customSignUpFee.label === dto.label);
    customSignUpFee
      ? Object.assign(customSignUpFee, dto)
      : customSignUpFeesArray.push(Object.assign(new CustomSignUpFees(), dto));

    await this.setObj<CustomSignUpFees[]>('customSignUpFees', customSignUpFeesArray);
  }

  async getCustomSignUpFees(ref?: string | undefined, walletId?: number | undefined): Promise<number[]> {
    return [].concat(await this.getCustomSignUpFeesWithRef(ref), await this.getCustomSignUpFeesWithWallet(walletId));
  }

  async getObj<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.settingRepo.findOneBy({ key }).then((d) => (d?.value ? JSON.parse(d?.value) : defaultValue));
  }

  async setObj<T>(key: string, value: T): Promise<void> {
    await this.settingRepo.save({ key, value: JSON.stringify(value) });
  }

  // --- HELPER METHODS --- //
  private async getCustomSignUpFeesWithRef(ref: string): Promise<number[]> {
    const customSignUpFees = await this.getObj<CustomSignUpFees[]>('customSignUpFees');

    return customSignUpFees.find((fee) => fee.ref === ref)?.fees ?? [];
  }

  private async getCustomSignUpFeesWithWallet(walletId: number): Promise<number[]> {
    const customSignUpFees = await this.getObj<CustomSignUpFees[]>('customSignUpFees');

    return customSignUpFees.find((fee) => fee.wallet === walletId)?.fees ?? [];
  }
}
