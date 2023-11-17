import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { Util } from 'src/shared/utils/util';
import { OrganizationDto } from './dto/organization.dto';
import { Organization } from './organization.entity';
import { OrganizationRepository } from './organization.repository';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly organizationRepo: OrganizationRepository,
    private readonly countryService: CountryService,
  ) {}

  async create(dto: OrganizationDto): Promise<Organization> {
    const organization = this.organizationRepo.create(dto);

    if (dto.countryId) {
      organization.country = await this.countryService.getCountry(dto.countryId);
      if (!organization.country) throw new BadRequestException('Country not found');
    }

    return this.organizationRepo.save(organization);
  }

  async update(id: number, update: OrganizationDto): Promise<Organization> {
    const organization = await this.organizationRepo.findOne({ where: { id }, relations: ['userData'] });
    if (!organization) throw new NotFoundException('Organization not found');

    Util.removeNullFields(update);

    if (update.countryId) {
      organization.country = await this.countryService.getCountry(update.countryId);
      if (!organization.country) throw new BadRequestException('Country not found');
    }

    return this.organizationRepo.save({ ...organization, ...update });
  }

  async getOrganization(id: number): Promise<Organization> {
    return this.organizationRepo.findOneBy({ id });
  }
}
