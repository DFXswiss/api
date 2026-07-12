import { Config } from 'src/config/config';
import { RealUnitLegalAcceptance } from '../entities/realunit-legal-acceptance.entity';
import { RealUnitLegalAgreement } from '../enums/realunit-legal-agreement.enum';
import { RealUnitLegalAgreementStatusDto, RealUnitLegalInfoDto } from './realunit-legal.dto';

export class RealUnitLegalDtoMapper {
  // Maps the user's latest acceptance row per agreement (those without any row are simply absent from the
  // list) plus the current-version map into the full status DTO for all six agreements.
  static toInfoDto(latestAcceptances: RealUnitLegalAcceptance[]): RealUnitLegalInfoDto {
    const byAgreement = new Map(latestAcceptances.map((a) => [a.agreement, a]));

    const agreements = Object.values(RealUnitLegalAgreement).map((agreement) =>
      RealUnitLegalDtoMapper.toStatusDto(agreement, byAgreement.get(agreement)),
    );

    return {
      agreements,
      allAccepted: agreements.every((a) => a.accepted),
    };
  }

  static toStatusDto(
    agreement: RealUnitLegalAgreement,
    latestAcceptance?: RealUnitLegalAcceptance,
  ): RealUnitLegalAgreementStatusDto {
    const currentVersion = Config.blockchain.realunit.legalVersions[agreement];

    return {
      agreement,
      currentVersion,
      acceptedVersion: latestAcceptance?.version,
      accepted: latestAcceptance != null && latestAcceptance.isVersion(currentVersion),
    };
  }
}
