import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
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

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async syncOrganization() {
    if (DisabledProcess(Process.ORGANIZATION_SYNC)) return;

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
            location: entity.location,
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

    if (dto.countryId) {
      organization.country = await this.countryService.getCountry(dto.countryId);
      if (!organization.country) throw new BadRequestException('Country not found');
    }

    return this.organizationRepo.save(organization);
  }

  async updateOrganizationInternal(entity: Organization, dto: OrganizationDto): Promise<Organization> {
    if (dto.countryId) {
      entity.country = await this.countryService.getCountry(dto.countryId);
      if (!entity.country) throw new BadRequestException('Country not found');
    }

    Object.assign(entity, dto);

    return this.organizationRepo.save(entity);
  }

  async getOrganizationByName(name: string, zip): Promise<Organization> {
    return this.organizationRepo.findOneBy({ name, zip });
  }
}
