import { BadRequestException, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
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

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.ORGANIZATION_SYNC, timeout: 1800 })
  async syncOrganization() {
    const entities = await this.userDataRepo.findBy({
      organization: { id: IsNull() },
      accountType: In([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP]),
    });

    for (const entity of entities) {
      try {
        // Nothing to match or create on — creating here would insert a nameless organisation per
        // affected user, one per cron run.
        if (!entity.organizationName) continue;

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
    if (Object.values(dto).every((value) => value === undefined)) return entity;

    if (dto.country?.id) {
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
    // organizationName is nullable on UserData, and without it the zip matches on its own — an
    // unrelated organisation comes back and gets linked. An absent zip is fine to drop: the name
    // still scopes the query, and matching every zip for a name is the dedup this is here for.
    if (!name) return undefined;

    return this.organizationRepo.findOneBy({ name, zip });
  }
}
