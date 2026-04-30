import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';

export class EntityDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;
}
