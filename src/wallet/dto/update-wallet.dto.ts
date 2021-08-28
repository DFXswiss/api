import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

export class UpdateWalletDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    @Length(34,42)
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @Length(88,88)
    @IsString()
    signature: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsEmail()
    mail: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description: string;
}