import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

export class UpdateDepositDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsOptional()
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsOptional()
    @IsBoolean()
    used: boolean;
}