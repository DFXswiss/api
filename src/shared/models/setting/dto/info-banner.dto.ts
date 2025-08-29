import { ApiProperty } from '@nestjs/swagger';

export class InfoBannerDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  de: string;

  @ApiProperty()
  en: string;

  @ApiProperty()
  fr: string;

  @ApiProperty()
  it: string;
}

export interface InfoBannerSetting {
  from: string;
  to: string;
  content: InfoBannerDto;
}
