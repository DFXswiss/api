import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsIBAN, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

export class GetBuyDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    id: number;

}