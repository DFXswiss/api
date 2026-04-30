import { ApiProperty } from '@nestjs/swagger';

export class LanguageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  foreignName: string;

  @ApiProperty()
  enable: boolean;
}
