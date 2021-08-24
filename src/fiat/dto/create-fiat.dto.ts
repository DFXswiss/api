import { ApiProperty, } from "@nestjs/swagger";
import {  IsBoolean,  IsInt, IsNotEmpty, IsOptional,  IsString, } from "class-validator";

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