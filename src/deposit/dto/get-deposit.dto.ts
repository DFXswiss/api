import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

export class GetDepositDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @IsOptional()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    @IsOptional()
    @IsString()
    address: string;
}