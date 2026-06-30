import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class SupportClerkAccountDto {
  @IsInt()
  @Min(1)
  account: number;

  @IsNotEmpty()
  @IsString()
  name: string;
}
