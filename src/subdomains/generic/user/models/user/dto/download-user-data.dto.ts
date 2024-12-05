import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty } from 'class-validator';

export class DownloadUserDataDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsArray()
  userDataIds: number[];
}
