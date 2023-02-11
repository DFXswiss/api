import { ApiProperty } from '@nestjs/swagger';

export class LinkAddressDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  existingAddress: string;

  @ApiProperty()
  newAddress: string;

  @ApiProperty()
  authentication: string;

  @ApiProperty()
  isCompleted: boolean;

  @ApiProperty()
  expiration: Date;
}
