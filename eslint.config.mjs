import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // This adapter is plain JavaScript and gets its types from JSDoc
        // (see tsconfig.json / "npm run check"), so @type & friends are not
        // redundant here.
        files: ['**/*.js', '**/*.mjs'],
        rules: {
            'jsdoc/check-tag-names': ['warn', { typed: false }],
        },
    },
    {
        // mocha injects these globals in the test files
        files: ['**/*.test.js', 'test/**/*.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                after: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
];
