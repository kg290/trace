import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './examples/profile', testMatch: 'profile.spec.ts', workers: 1, reporter: 'list', outputDir: '.test-output/independent' });
