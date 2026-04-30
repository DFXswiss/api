import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AssignPaymentLinkDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  publicName: string;
}
