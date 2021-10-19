import { ApiProperty, } from "@nestjs/swagger";
import {  IsBoolean, IsNotEmpty, IsOptional,  IsString, } from "class-validator";

export class CreateFiatDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsBoolean()
    @IsOptional()
    enable: boolean;
}