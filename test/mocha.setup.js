'use strict';

// Configure the mocha environment: wire up the chai assertion plugins used
// across the unit tests (promise assertions + sinon matchers).
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');

chai.use(chaiAsPromised);
chai.use(sinonChai);
