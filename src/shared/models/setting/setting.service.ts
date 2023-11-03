import { Injectable } from '@nestjs/common';
import { CakeFlowDto, CakeSettings } from './dto/cake-flow.dto';
import { FeeMapper, UpdateFeeMapperDto } from './dto/fee-mapper.dto';
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

  async updateFeeMapper(dto: UpdateFeeMapperDto): Promise<void> {
    const feeMapperArray = await this.getObj<FeeMapper[]>('feeMapper');

    const feeMapper = feeMapperArray.find((feeMapper) => feeMapper.label === dto.label);
    feeMapper ? Object.assign(feeMapper, dto) : feeMapperArray.push(Object.assign(new FeeMapper(), dto));

    await this.setObj<FeeMapper[]>('feeMapper', feeMapperArray);
  }

  async getFeeWithMapper(ref?: string | undefined, walletId?: number | undefined): Promise<number[]> {
    return [].concat(await this.getFeeWithRefMapper(ref), await this.getFeeWithWalletMapper(walletId));
  }

  async getObj<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.settingRepo.findOneBy({ key }).then((d) => (d?.value ? JSON.parse(d?.value) : defaultValue));
  }

  async setObj<T>(key: string, value: T): Promise<void> {
    await this.settingRepo.save({ key, value: JSON.stringify(value) });
  }

  // --- HELPER METHODS --- //
  private async getFeeWithRefMapper(ref: string): Promise<number[]> {
    const feeMapper = await this.getObj<FeeMapper[]>('feeMapper');

    return feeMapper.find((fee) => fee.ref === ref)?.fee ?? [];
  }

  private async getFeeWithWalletMapper(walletId: number): Promise<number[]> {
    const feeMapper = await this.getObj<FeeMapper[]>('feeMapper');

    return feeMapper.find((fee) => fee.wallet === walletId)?.fee ?? [];
  }
}
