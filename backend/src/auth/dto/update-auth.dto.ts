import { PartialType } from '@nestjs/mapped-types';
import { RegisterAuthDto } from './register-auth.dto.js';

export class UpdateAuthDto extends PartialType(RegisterAuthDto) {}
