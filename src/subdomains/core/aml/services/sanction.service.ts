import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { Sanction } from '../entities/sanction.entity';
import { SanctionRepository } from '../repositories/sanction.repository';

interface SanctionFeatureType {
  '#text': string;
  '@_ID': string;
}

interface SanctionFeature {
  '@_FeatureTypeID': string;
  FeatureVersion: { VersionDetail: { '#text': string } };
}

interface SanctionList {
  ReferenceValueSets: { FeatureTypeValues: { FeatureType: SanctionFeatureType[] } };
  DistinctParties: {
    DistinctParty: {
      Profile: {
        Feature: SanctionFeature | SanctionFeature[];
      };
    }[];
  };
}

@Injectable()
export class SanctionService {
  private readonly fileUrl = 'https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml';
  private readonly fileName = 'sdn_advanced.xml';

  constructor(
    private readonly http: HttpService,
    private readonly sanctionRepo: SanctionRepository,
  ) {}

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_WEEKEND, { process: Process.SANCTION_SYNC })
  async syncList() {
    const filePath = Config.environment === Environment.LOC ? this.fileName : `/home/${this.fileName}`;

    await this.http.downloadFile(this.fileUrl, filePath);
    const file = await Util.readFileFromDisk(filePath);
    const sanctions = this.parseSanctionedAddresses(file);

    const currencyMap = Util.groupBy<Sanction, string>(sanctions, 'currency');

    for (const [currency, sanctions] of currencyMap.entries()) {
      const existingSanctions = await this.sanctionRepo.findBy({ currency });
      const newSanctions = sanctions.filter((ns) => !existingSanctions.some((es) => ns.address === es.address));
      await this.sanctionRepo.save(newSanctions);
    }
  }

  private parseSanctionedAddresses(file: string): Sanction[] {
    const xml = Util.parseXml<{ Sanctions: SanctionList }>(file);

    const featureTypes = Util.toMap(
      xml.Sanctions.ReferenceValueSets.FeatureTypeValues.FeatureType.filter((i) =>
        i['#text']?.includes('Digital Currency Address'),
      ).map((i) => ({ currency: i['#text'].replace('Digital Currency Address - ', ''), type: i['@_ID'] })),
      'type',
    );

    const features = xml.Sanctions.DistinctParties.DistinctParty.filter((p) => p.Profile.Feature)
      .map((p) => (Array.isArray(p.Profile.Feature) ? p.Profile.Feature : [p.Profile.Feature]))
      .flat();

    return features
      .map((f) => {
        const currency = featureTypes.get(f['@_FeatureTypeID'])?.currency;
        return currency
          ? this.sanctionRepo.create({ currency, address: f.FeatureVersion.VersionDetail['#text'] })
          : undefined;
      })
      .filter((f) => f);
  }
}
