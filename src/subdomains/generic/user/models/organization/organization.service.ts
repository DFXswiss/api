import { BadRequestException, Injectable } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { Organization } from './organization.entity';
import { OrganizationRepository } from './organization.repository';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly organizationRepo: OrganizationRepository,
    private readonly countryService: CountryService,
  ) {}

  async createOrganization(dto: CreateOrganizationDto): Promise<Organization> {
    const organization = this.organizationRepo.create(dto);

    if (dto.countryId) {
      organization.country = await this.countryService.getCountry(dto.countryId);
      if (!organization.country) throw new BadRequestException('Country not found');
    }

    return this.organizationRepo.save(organization);
  }

  async getOrganization(id: number): Promise<Organization> {
    return this.organizationRepo.findOneBy({ id });
  }
}
