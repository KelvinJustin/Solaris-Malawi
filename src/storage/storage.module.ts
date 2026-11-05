
import { Module } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service.js';

@Module({
    providers: [R2StorageService],
    exports: [R2StorageService],
})
export class StorageModule { }
