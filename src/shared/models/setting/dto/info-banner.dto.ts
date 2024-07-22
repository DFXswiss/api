import { ApiProperty } from '@nestjs/swagger';

export class InfoBannerDto {
  @ApiProperty()
  de: string;

  @ApiProperty()
  en: string;

  @ApiProperty()
  fr: string;

  @ApiProperty()
  it: string;
}
