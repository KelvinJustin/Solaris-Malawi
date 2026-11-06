
import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
} from 'class-validator';

export class LoginAuthDto {

  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}