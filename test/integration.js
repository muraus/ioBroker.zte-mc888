'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');

// Run the standard integration tests: a real js-controller is set up in a
// temporary directory, the adapter is installed into it and started once to
// verify it boots without crashing.
//
// The adapter is left with its default config (no router IP), so it logs an
// error and stops polling instead of talking to a device. That is exactly the
// startup path we want to exercise here without needing a real ZTE MC888.
tests.integration(path.join(__dirname, '..'), {
    // Pin the stable js-controller instead of the default "dev" dist-tag.
    // The dev/alpha controller's "setup first" intermittently fails to create
    // iobroker-data/iobroker.json on CI (Linux) runners, which aborts the
    // prepareTests hook with ENOENT before the adapter is ever started.
    controllerVersion: 'latest',

    // Uncomment to define custom tests that need a running adapter instance.
    // defineAdditionalTests({ suite }) {
    //     suite('Test sendTo()', (getHarness) => { ... });
    // },
});
