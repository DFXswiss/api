import { BadRequestException, Injectable } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { OrganizationDto } from './dto/organization.dto';
import { Organization } from './organization.entity';
import { OrganizationRepository } from './organization.repository';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly organizationRepo: OrganizationRepository,
    private readonly countryService: CountryService,
  ) {}

  async createOrganization(dto: OrganizationDto): Promise<Organization> {
    const organization = this.organizationRepo.create(dto);

    return this.organizationRepo.save(organization);
  }

  async updateOrganizationInternal(entity: Organization, dto: OrganizationDto): Promise<Organization> {
    if (dto.country.id) {
      entity.country = await this.countryService.getCountry(dto.country.id);
      if (!entity.country) throw new BadRequestException('Country not found');
    }

    Object.assign(entity, {
      ...dto,
      name: dto.name,
      street: dto.street,
      houseNumber: dto.houseNumber,
      location: dto.location,
      zip: dto.zip,
      country: dto.country,
    });

    return this.organizationRepo.save(entity);
  }

  async getOrganizationByName(name: string, zip: string): Promise<Organization> {
    return this.organizationRepo.findOneBy({ name, zip });
  }
}
