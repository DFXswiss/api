import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum } from 'class-validator';
import { UserStatus } from 'src/user/models/user/user.entity';

export class UpdateStatusDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(UserStatus)
  status: UserStatus;
}
