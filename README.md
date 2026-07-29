# ioBroker.zte-mc888

Reads LTE and 5G signal values from a ZTE MC888 router and exposes them as ioBroker states.

## Supported device

[ZTE MC888 5G FWA (indoor router)](https://www.ztedevices.com/de/products/mobile-internet/5g-fwa/MC888.html)
— product page at ZTE Devices.

The adapter talks to the router's local `goform` HTTP API, so no cloud account and no
internet connection are required.

## States

- `general.networkType`, `general.mcc`, `general.mnc`
- `lte.rsrp`, `lte.rsrq`, `lte.sinr`, `lte.rssi`, `lte.band`, `lte.bandwidth`, `lte.carrierAggregation`
- `nr5g.rsrp`, `nr5g.rsrq`, `nr5g.sinr`, `nr5g.pci`, `nr5g.band`, `nr5g.cellId`, `nr5g.arfcn`
- `info.connection` — true while the last poll succeeded

## Configuration

- **Router IP** — usually `192.168.0.1`, some firmwares use `192.168.254.1`.
- **Poll interval** — seconds between reads (min 5).
- **Login required** — enable if the API only answers after authentication.
- **Username / Password** — the router admin credentials (username defaults to `admin`).
- **Web UI has priority** *(only with login)* — when the router web interface logs
  in with the same user, the adapter pauses instead of logging back in and kicking
  it out. See below.
- **Back-off after web UI login (minutes)** *(only with login)* — how long the
  adapter stays logged out (keeping the last values) after the web UI took over the
  session. Default 5. Set to `0` to re-login on the very next poll.

## Login, sessions and the web UI

The MC888 only serves a handful of fields (network type + primary RSRP/RSSI) without
authentication; RSRQ, SINR, bands, PCI, carrier aggregation and the secondary cells
require a login. The router also allows **only one session per user**, and a second
login silently kicks the first.

To avoid fighting the router web interface (same `admin` user), the adapter:

1. logs in once and **keeps** the session across polls (full field set),
2. detects when another login (the web UI) takes over its session,
3. then **backs off** for the configured time instead of immediately logging back
   in — during that window the last values are kept and only the public fields keep
   updating, so your web-UI session is not disturbed,
4. re-acquires the session once the back-off elapses.

If you would rather always have the full data and don't mind the web UI being logged
out, disable **Web UI has priority** (or set the back-off to `0`).

## Firmware differences

The raw field names (`Z5g_rsrp`, `lte_snr`, …) vary between firmware versions. If some
states stay empty, set the adapter log level to `debug`: the raw router JSON is logged
on every poll, so you can see the actual field names and adjust `lib/fields.js`
accordingly.

The login flow uses `LOGIN_MULTI_USER` with the `AD` token
(`MD5( MD5(cr_version + wa_inner_version) + RD )`) and password hash
`SHA256( SHA256(password) + LD )`.

## Install

Upload/install the adapter directory into ioBroker, then create an instance.

## Development / Testing

Requires Node.js >= 22 and npm.

```bash
npm install          # install dependencies (incl. the test framework)
npm test             # unit tests + package validation
npm run test:js      # only the unit tests (fields + zteClient, no router needed)
npm run test:package # validate package.json / io-package.json
npm run test:integration  # boot the adapter in a temporary js-controller
```

The unit tests run entirely offline: `lib/zteClient.test.js` spins up a local
mock HTTP server that emulates the router's goform API, so no real ZTE MC888 is
needed. The integration test downloads and starts a real js-controller in a temp
directory (needs internet on first run).

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (Adapterman) Added the supported device section with a link to the ZTE MC888 product page
* (Adapterman) Corrected the required Node.js version in the development section
* (Adapterman) Added the readme link to io-package.json so Admin can link the documentation
* (Adapterman) Completed the author information in package.json, io-package.json and LICENSE

### 0.0.3 (2026-07-25)
* (Adapterman) Added ESLint (@iobroker/eslint-config) and prettier config plus a `lint` script
* (Adapterman) Added a tsconfig.json and a `check` script to type check the JavaScript sources via JSDoc
* (Adapterman) Fixed a crash in the poll loop when the router did not answer and no login is configured
* (Adapterman) Admin config is now translated into all 11 ioBroker languages (jsonConfig i18n)
* (Adapterman) Added dependabot configuration and VS Code JSON schema settings
* (Adapterman) Lint and type checking are now enforced in CI

### 0.0.2 (2026-07-25)
* (Adapterman) Normalized the repository URL in package.json
* (Adapterman) Release is published via npm trusted publishing and signed with provenance

### 0.0.1 (2026-07-25)
* (Adapterman) Initial release

## License

MIT License

Copyright (c) 2026 Adapterman <adapterman@proton.me>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
