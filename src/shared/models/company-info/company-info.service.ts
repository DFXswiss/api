import { Injectable, NotFoundException } from '@nestjs/common';
import { CompanyInfo } from './company-info.entity';
import { CompanyInfoRepository } from './company-info.repository';

@Injectable()
export class CompanyInfoService {
  constructor(private readonly repo: CompanyInfoRepository) {}

  async getForBrand(brand: string): Promise<CompanyInfo> {
    const info = await this.repo.findOneCachedBy(`brand:${brand.toLowerCase()}`, {
      brand,
      enabled: true,
    });
    if (!info) throw new NotFoundException(`CompanyInfo for brand "${brand}" not found`);
    return info;
  }
}
