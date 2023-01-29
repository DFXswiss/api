import { ApiProperty } from '@nestjs/swagger';

export class FiatDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  buyable: boolean;

  @ApiProperty()
  sellable: boolean;
}
