import { ApiProperty } from '@nestjs/swagger';
import { ErrorDto } from 'src/shared/dto/error.dto';

export class MergedDto extends ErrorDto {
  @ApiProperty()
  switchToCode: string;
}
