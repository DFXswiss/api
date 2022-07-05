import { IsInt, IsNotEmpty } from 'class-validator';

export class EntityDto {
  @IsNotEmpty()
  @IsInt()
  id: number;
}
