import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

export class GetCountryDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    @IsOptional()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    @IsOptional()
    name: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    @IsOptional()
    symbol: string;

}