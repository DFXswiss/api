import { IsEnum, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export enum LetterColor {
  COLOR = '4',
  NO_COLOR = '1',
}

export enum LetterMode {
  SIMPLEX = 'simplex',
  DUPLEX = 'duplex',
}

export enum LetterShip {
  NATIONAL = 'national',
  INTERNATIONAL = 'international',
}

export class SendLetterDto {
  @IsNotEmpty()
  @IsString()
  data: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Max(9)
  page: number;

  @IsNotEmpty()
  @IsEnum(LetterColor)
  color: LetterColor;

  @IsNotEmpty()
  @IsEnum(LetterMode)
  mode: LetterMode;

  @IsNotEmpty()
  @IsEnum(LetterShip)
  ship: LetterShip;
}
