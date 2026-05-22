import { Injectable, NotFoundException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { CompanyInfo } from './company-info.entity';
import { CompanyInfoRepository } from './company-info.repository';

@Injectable()
export class CompanyInfoService {
  constructor(private readonly repo: CompanyInfoRepository) {}

  async getForBrand(brand: string): Promise<CompanyInfo> {
    const info = await this.repo.findOneCachedBy(`brand:${brand.toLowerCase()}`, {
      brand: ILike(brand),
      enabled: true,
    });
    if (!info) throw new NotFoundException(`CompanyInfo for brand "${brand}" not found`);
    return info;
  }
}
