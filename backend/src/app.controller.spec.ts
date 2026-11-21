
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppController } from './app.controller.js';

describe('AppController', () => {
    let appController: AppController;

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [AppController],
        }).compile();

        appController = app.get<AppController>(AppController);
    });

    describe('getTest', () => {
        it('should return the solaris API status message', () => {
            expect(appController.getTest()).toBe(
                'message: solaris API is working',
            );
        });
    });
});
