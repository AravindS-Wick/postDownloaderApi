import { defineConfig } from 'vitest/config.js';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'dist/',
                '**/*.d.ts',
                '**/*.test.ts',
                '**/*.config.ts',
                '**/types/',
                '**/__mocks__/'
            ]
        }
    }
}); 
