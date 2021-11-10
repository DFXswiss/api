import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsNumber } from "class-validator";

export class Order {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  from: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  to: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;
}