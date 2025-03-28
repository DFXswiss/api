import { BadRequestException, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { In, IsNull } from 'typeorm';
import { AccountType } from '../user-data/account-type.enum';
import { UserDataRepository } from '../user-data/user-data.repository';
import { OrganizationDto } from './dto/organization.dto';
import { Organization } from './organization.entity';
import { OrganizationRepository } from './organization.repository';

@Injectable()
export class OrganizationService {
  private readonly logger = new DfxLogger(OrganizationService);

  constructor(
    private readonly organizationRepo: OrganizationRepository,
    private readonly countryService: CountryService,
    private readonly userDataRepo: UserDataRepository,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.ORGANIZATION_SYNC, timeout: 1800 })
  async syncOrganization() {
    const entities = await this.userDataRepo.findBy({
      organization: { id: IsNull() },
      accountType: In([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP]),
    });

    for (const entity of entities) {
      try {
        const organization =
          (await this.getOrganizationByName(entity.organizationName, entity.organizationZip)) ??
          (await this.createOrganization({
            name: entity.organizationName,
            street: entity.organizationStreet,
            houseNumber: entity.organizationHouseNumber,
            location: entity.organizationLocation,
            zip: entity.organizationZip,
            country: entity.organizationCountry,
            allBeneficialOwnersName: entity.allBeneficialOwnersName,
            allBeneficialOwnersDomicile: entity.allBeneficialOwnersDomicile,
            accountOpenerAuthorization: entity.accountOpenerAuthorization,
            complexOrgStructure: entity.complexOrgStructure,
            accountOpener: entity.accountOpener,
            legalEntity: entity.legalEntity,
            signatoryPower: entity.signatoryPower,
          }));

        await this.userDataRepo.update(entity.id, { organization });
      } catch (e) {
        this.logger.error(`Error in organization sync ${entity.id}: `, e);
      }
    }
  }

  async createOrganization(dto: OrganizationDto): Promise<Organization> {
    const organization = this.organizationRepo.create(dto);

    return this.organizationRepo.save(organization);
  }

  async updateOrganizationInternal(entity: Organization, dto: OrganizationDto): Promise<Organization> {
    if (dto.organizationCountryId) {
      entity.country = await this.countryService.getCountry(dto.organizationCountryId);
      if (!entity.country) throw new BadRequestException('Country not found');
    }

    Object.assign(entity, {
      ...dto,
      name: dto.name ?? dto.organizationName,
      street: dto.street ?? dto.organizationStreet,
      houseNumber: dto.houseNumber ?? dto.organizationHouseNumber,
      location: dto.location ?? dto.organizationLocation,
      zip: dto.zip ?? dto.organizationZip,
      country: dto.country ?? dto.organizationCountry,
    });

    return this.organizationRepo.save(entity);
  }

  async getOrganizationByName(name: string, zip: string): Promise<Organization> {
    return this.organizationRepo.findOneBy({ name, zip });
  }
}
