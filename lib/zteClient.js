'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL, URLSearchParams } = require('node:url');

/**
 * Minimal HTTP client for the ZTE MC888 goform API.
 *
 * Ports the logic from the standalone console tool:
 *  - password hash: SHA256( SHA256(password) + LD )
 *  - AD token:      MD5( MD5(cr_version + wa_inner_version) + RD )
 *  - login action:  goformId=LOGIN_MULTI_USER
 *
 * No external HTTP dependency is used; the built-in `http` module is enough
 * for the plain-HTTP local API of the router.
 */
class ZteClient {
    /**
     * @param {string} ip        router ip, e.g. "192.168.0.1"
     * @param {object} [options] client options
     * @param {number} [options.timeout] request timeout in ms (default 10000)
     */
    constructor(ip, options = {}) {
        this.ip = ip;
        this.timeout = options.timeout || 10000;
        this.cookie = null;
    }

    /**
     * SHA256 hash in upper case hex, as expected by the router password hashing.
     *
     * @param {string} input value to hash
     * @returns {string} hex digest in upper case
     */
    _sha256Upper(input) {
        return crypto.createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase();
    }

    /**
     * MD5 hash in lower case hex, used for the inner part of the AD token.
     *
     * @param {string} input value to hash
     * @returns {string} hex digest in lower case
     */
    _md5Lower(input) {
        return crypto.createHash('md5').update(input, 'utf8').digest('hex').toLowerCase();
    }

    /**
     * MD5 hash in upper case hex, used for the final AD token.
     *
     * @param {string} input value to hash
     * @returns {string} hex digest in upper case
     */
    _md5Upper(input) {
        return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
    }

    /**
     * Low-level request helper. Returns parsed JSON.
     *
     * @param {'GET'|'POST'} method HTTP method to use
     * @param {string} path path incl. query string, e.g. "/goform/goform_get_cmd_process?..."
     * @param {object|null} [formBody] URL-encoded form body for POST
     * @returns {Promise<object>} the parsed JSON response
     */
    _request(method, path, formBody = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(`http://${this.ip}${path}`);
            const bodyStr = formBody ? new URLSearchParams(formBody).toString() : null;

            const headers = {
                Referer: `http://${this.ip}/`,
                Accept: 'application/json, text/plain, */*',
            };
            if (this.cookie) {
                headers.Cookie = this.cookie;
            }
            if (bodyStr) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(bodyStr);
            }

            const req = http.request(
                {
                    hostname: url.hostname,
                    port: url.port || 80,
                    path: url.pathname + url.search,
                    method,
                    headers,
                    timeout: this.timeout,
                },
                res => {
                    // Capture session cookie if the router hands one out.
                    const setCookie = res.headers['set-cookie'];
                    if (setCookie && setCookie.length) {
                        const stok = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('stok='));
                        if (stok) {
                            this.cookie = stok;
                        }
                    }

                    let data = '';
                    res.setEncoding('utf8');
                    res.on('data', chunk => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        const status = res.statusCode || 0;
                        if (status < 200 || status >= 300) {
                            reject(new Error(`HTTP ${status} for ${path}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            reject(new Error(`Invalid JSON from ${path}: ${data.slice(0, 200)}`));
                        }
                    });
                },
            );

            req.on('error', e => reject(e));
            req.on('timeout', () => {
                req.destroy(new Error(`Timeout for ${path}`));
            });

            if (bodyStr) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    /**
     * Fetch a single scalar field via the get endpoint.
     *
     * @param {string} field raw router field name, e.g. "cr_version"
     * @returns {Promise<string>} the field value, empty string if the router did not return it
     */
    async getField(field) {
        const path = `/goform/goform_get_cmd_process?isTest=false&cmd=${encodeURIComponent(field)}`;
        const json = await this._request('GET', path);
        return json && json[field] != null ? String(json[field]) : '';
    }

    /**
     * Perform the LOGIN_MULTI_USER flow with AD token.
     *
     * @param {string} user router user name, usually "admin"
     * @param {string} password plain text password, hashed before it is sent
     * @throws {Error} if the router returns a non-zero result; `sessionBusy` is set when another session is active
     */
    async login(user, password) {
        const crVersion = await this.getField('cr_version');
        const waInnerVersion = await this.getField('wa_inner_version');

        const ld = await this.getField('LD');
        const hashedPw = this._sha256Upper(this._sha256Upper(password) + ld);

        const rd = await this.getField('RD');
        const ad = this._md5Upper(this._md5Lower(crVersion + waInnerVersion) + rd);

        const json = await this._request('POST', '/goform/goform_set_cmd_process', {
            isTest: 'false',
            goformId: 'LOGIN_MULTI_USER',
            user,
            password: hashedPw,
            AD: ad,
        });

        const result = json && json.result != null ? String(json.result) : 'unknown';
        if (result !== '0') {
            const err = /** @type {Error & {sessionBusy?: boolean, result?: string}} */ (
                new Error(`Login failed (result=${result}). 0=OK, 1=wrong password, 3=already logged in / other error.`)
            );
            // Flag the "another session is active" case so the adapter can back off
            // instead of treating it as a hard error.
            err.sessionBusy = result === '3';
            err.result = result;
            throw err;
        }
    }

    /**
     * Query several fields at once via multi_data.
     *
     * @param {string[]} cmds raw router field names to query in one request
     * @returns {Promise<Record<string,string>>} map of field name to value, missing values become empty strings
     */
    async getSignal(cmds) {
        const cmd = cmds.join(',');
        const path = `/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=${encodeURIComponent(cmd)}`;
        const json = await this._request('GET', path);

        /** @type {Record<string,string>} */
        const out = {};
        for (const key of Object.keys(json || {})) {
            const v = json[key];
            out[key] = v == null ? '' : String(v);
        }
        return out;
    }

    /**
     * Best-effort logout so the router session is freed.
     */
    async logout() {
        try {
            await this._request('POST', '/goform/goform_set_cmd_process', {
                isTest: 'false',
                goformId: 'LOGOUT',
            });
        } catch {
            // ignore, the session is dropped locally anyway
        }
        this.cookie = null;
    }
}

module.exports = { ZteClient };
