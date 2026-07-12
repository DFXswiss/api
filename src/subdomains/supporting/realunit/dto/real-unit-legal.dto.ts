import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';
import { RealUnitLegalAgreement } from '../enums/real-unit-legal-agreement.enum';

export class RealUnitLegalAgreementStatusDto {
  @ApiProperty({ enum: RealUnitLegalAgreement })
  agreement: RealUnitLegalAgreement;

  @ApiProperty({ description: 'Current version of the agreement (format YYYYMMDD)' })
  currentVersion: string;

  @ApiPropertyOptional({ description: 'Version the user last accepted (format YYYYMMDD); absent if never accepted' })
  acceptedVersion?: string;

  @ApiProperty({ description: 'Whether the user has accepted the current version of the agreement' })
  accepted: boolean;
}

export class RealUnitLegalInfoDto {
  @ApiProperty({ type: RealUnitLegalAgreementStatusDto, isArray: true })
  agreements: RealUnitLegalAgreementStatusDto[];

  @ApiProperty({ description: 'Whether the user has accepted the current version of every agreement' })
  allAccepted: boolean;
}

export class AcceptRealUnitLegalDto {
  @ApiProperty({
    enum: RealUnitLegalAgreement,
    isArray: true,
    description: 'Agreements the user accepts; each is stamped with the current server-side version',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(RealUnitLegalAgreement, { each: true })
  agreements: RealUnitLegalAgreement[];
}
