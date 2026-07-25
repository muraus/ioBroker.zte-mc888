'use strict';

const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Validate the package files (package.json + io-package.json) against the
// ioBroker adapter requirements.
tests.packageFiles(path.join(__dirname, '..'));
