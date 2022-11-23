import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ deprecated: true })
  enable: boolean;
}
