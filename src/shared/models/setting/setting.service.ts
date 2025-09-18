import { BadRequestException, Injectable } from '@nestjs/common';
import { Process } from 'src/shared/services/process.service';
import { CustomSignUpFeesDto } from './dto/custom-sign-up-fees.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
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
    const entity = (await this.settingRepo.findOneBy({ key })) ?? this.settingRepo.create({ key });
    entity.value = value;

    await this.settingRepo.save(entity);
  }

  async getIpBlacklist(): Promise<string[]> {
    return (await this.getObjCached<string[]>('ipBlacklist')) ?? [];
  }

  async addIpToBlacklist(ip: string): Promise<void> {
    const ipBlacklist = await this.getIpBlacklist();

    if (!ipBlacklist.some((blockedIp) => blockedIp === ip)) {
      ipBlacklist.push(ip);

      await this.setObj<string[]>('ipBlacklist', ipBlacklist);
    }
  }

  async deleteIpFromBlacklist(ip: string): Promise<void> {
    const ipBlacklist = await this.getIpBlacklist();
    if (!ipBlacklist.some((blockedIp) => blockedIp === ip)) throw new BadRequestException('Blocked IP not found');

    await this.setObj<string[]>(
      'ipBlacklist',
      ipBlacklist.filter((blockedIp) => blockedIp !== ip),
    );
  }

  async updateCustomSignUpFees(dto: CustomSignUpFeesDto): Promise<void> {
    const customSignUpFeesArray = (await this.getObj<CustomSignUpFeesDto[]>('customSignUpFees')) ?? [];

    const customSignUpFee = customSignUpFeesArray.find((customSignUpFee) => customSignUpFee.label === dto.label);
    customSignUpFee ? Object.assign(customSignUpFee, dto) : customSignUpFeesArray.push(dto);

    await this.setObj<CustomSignUpFeesDto[]>('customSignUpFees', customSignUpFeesArray);
  }

  async updateProcess(dto: UpdateProcessDto): Promise<void> {
    const disabledProcesses = await this.getDisabledProcesses();
    const index = disabledProcesses.indexOf(dto.process);

    index >= 0 ? disabledProcesses.splice(index, 1) : disabledProcesses.push(dto.process);

    await this.setObj<Process[]>('disabledProcess', disabledProcesses);
  }

  async getDisabledProcesses(): Promise<Process[]> {
    return this.getObj<Process[]>('disabledProcess', []);
  }

  async getCustomSignUpFees(ref?: string | undefined, walletId?: number | undefined): Promise<number[]> {
    const customSignUpFees = await this.getObj<CustomSignUpFeesDto[]>('customSignUpFees');
    return customSignUpFees?.find((fee) => fee.ref === ref || fee.wallet === walletId)?.fees ?? [];
  }

  async getObj<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.settingRepo.findOneBy({ key }).then((d) => (d?.value ? JSON.parse(d?.value) : defaultValue));
  }

  async getObjCached<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.settingRepo.findOneCachedBy(key, { key }).then((d) => (d?.value ? JSON.parse(d?.value) : defaultValue));
  }

  async setObj<T>(key: string, value: T): Promise<void> {
    const entity = (await this.settingRepo.findOneBy({ key })) ?? this.settingRepo.create({ key });
    entity.value = JSON.stringify(value);

    await this.settingRepo.save(entity);
  }
}
