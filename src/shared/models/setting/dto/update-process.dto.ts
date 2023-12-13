import { IsEnum, IsNotEmpty } from 'class-validator';
import { Process } from 'src/shared/services/process.service';

export class UpdateProcessDto {
  @IsNotEmpty()
  @IsEnum(Process)
  process: Process;
}
