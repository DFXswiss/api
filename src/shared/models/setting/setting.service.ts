import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Process } from 'src/shared/services/process.service';
import { CustomSignUpFeesDto } from './dto/custom-sign-up-fees.dto';
import { ExchangeTradingFeeDto } from './dto/exchange-trading-fee.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import { Setting } from './setting.entity';
import { SettingRepository } from './setting.repository';
import { isArraySchema, isPrimitiveSchema, SettingSchema, SettingSchemaRegistry } from './setting-schema.registry';

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
    await this.validateSettingValue(key, value);

    const entity = (await this.settingRepo.findOneBy({ key })) ?? this.settingRepo.create({ key });
    entity.value = value;

    await this.settingRepo.save(entity);
  }

  private async validateSettingValue(key: string, value: string): Promise<void> {
    const schema = SettingSchemaRegistry[key];
    if (!schema) return;

    if (isPrimitiveSchema(schema)) {
      this.validatePrimitive(key, value, schema);
      return;
    }

    if (isArraySchema(schema)) {
      await this.validateArray(key, value, schema.items);
    }
  }

  private validatePrimitive(key: string, value: string, schema: SettingSchema): void {
    switch (schema) {
      case 'number':
        if (isNaN(Number(value))) {
          throw new BadRequestException(`Setting '${key}' must be a valid number`);
        }
        break;
      case 'boolean':
        if (value !== 'true' && value !== 'false') {
          throw new BadRequestException(`Setting '${key}' must be 'true' or 'false'`);
        }
        break;
      case 'string[]':
        this.validateStringArray(key, value);
        break;
    }
  }

  private validateStringArray(key: string, value: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException(`Setting '${key}' must be valid JSON`);
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(`Setting '${key}' must be an array`);
    }

    if (!parsed.every((item) => typeof item === 'string')) {
      throw new BadRequestException(`Setting '${key}' must be an array of strings`);
    }
  }

  private async validateArray<T extends object>(key: string, value: string, dtoClass: new () => T): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException(`Setting '${key}' must be valid JSON`);
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(`Setting '${key}' must be an array`);
    }

    const instances = plainToInstance(dtoClass, parsed);
    for (let i = 0; i < instances.length; i++) {
      const errors = await validate(instances[i]);
      if (errors.length > 0) {
        const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
        throw new BadRequestException(`Setting '${key}' validation failed at index ${i}: ${messages.join(', ')}`);
      }
    }
  }

  async getIpBlacklist(): Promise<string[]> {
    return this.getObjCached<string[]>('ipBlacklist', []);
  }

  async addIpToBlacklist(ip: string): Promise<void> {
    const ipBlacklist = await this.getIpBlacklist();

    if (!ipBlacklist.includes(ip)) {
      ipBlacklist.push(ip);

      await this.setObj<string[]>('ipBlacklist', ipBlacklist);

      this.settingRepo.invalidateCache();
    }
  }

  async deleteIpFromBlacklist(ip: string): Promise<void> {
    const ipBlacklist = await this.getIpBlacklist();
    if (!ipBlacklist.includes(ip)) throw new BadRequestException('Blocked IP not found');

    await this.setObj<string[]>(
      'ipBlacklist',
      ipBlacklist.filter((blockedIp) => blockedIp !== ip),
    );

    this.settingRepo.invalidateCache();
  }

  async updateCustomSignUpFees(dto: CustomSignUpFeesDto): Promise<void> {
    const customSignUpFeesArray = await this.getObj<CustomSignUpFeesDto[]>('customSignUpFees', []);

    const customSignUpFee = customSignUpFeesArray.find((customSignUpFee) => customSignUpFee.label === dto.label);
    if (customSignUpFee) {
      Object.assign(customSignUpFee, dto);
    } else {
      customSignUpFeesArray.push(dto);
    }

    await this.setObj<CustomSignUpFeesDto[]>('customSignUpFees', customSignUpFeesArray);
  }

  async updateProcess(dto: UpdateProcessDto): Promise<void> {
    const disabledProcesses = await this.getDisabledProcesses();
    const index = disabledProcesses.indexOf(dto.process);

    if (index >= 0) {
      disabledProcesses.splice(index, 1);
    } else {
      disabledProcesses.push(dto.process);
    }

    await this.setObj<Process[]>('disabledProcess', disabledProcesses);
  }

  async getDisabledProcesses(): Promise<Process[]> {
    return this.getObj<Process[]>('disabledProcess', []);
  }

  async getCustomSignUpFees(ref?: string | undefined, walletId?: number | undefined): Promise<number[]> {
    const customSignUpFees = await this.getObj<CustomSignUpFeesDto[]>('customSignUpFees');
    return customSignUpFees?.find((fee) => fee.ref === ref || fee.wallet === walletId)?.fees ?? [];
  }

  async getKrakenTradingFee(): Promise<ExchangeTradingFeeDto | undefined> {
    return this.getObjCached<ExchangeTradingFeeDto>('krakenTradingFee');
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
