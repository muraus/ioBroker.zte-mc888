'use strict';

const { expect } = require('chai');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { ZteClient } = require('../lib/zteClient');

/**
 * Spin up a tiny HTTP server that mimics the ZTE MC888 goform API so the client
 * can be exercised end-to-end without a real router.
 *
 * @param {object} opts mock router options
 * @param {object} [opts.values] map of field -> value returned by GET
 * @param {(bodyParams: object) => object} [opts.onPost] handler returning the response object for POST
 * @returns {Promise<{client: ZteClient, close: () => Promise<void>, posts: object[]}>} the client bound to the
 *          mock router, a close helper and the list of received POST bodies
 */
function startMockRouter(opts = {}) {
    const values = opts.values || {};
    const posts = [];

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');

        if (req.method === 'GET' && url.pathname === '/goform/goform_get_cmd_process') {
            const cmd = url.searchParams.get('cmd') || '';
            const body = {};
            if (url.searchParams.get('multi_data') === '1') {
                for (const key of cmd.split(',')) {
                    body[key] = values[key] !== undefined ? values[key] : '';
                }
            } else {
                body[cmd] = values[cmd] !== undefined ? values[cmd] : '';
            }
            res.setHeader('Set-Cookie', 'stok=abc123; path=/');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/goform/goform_set_cmd_process') {
            let data = '';
            req.on('data', c => {
                data += c;
            });
            req.on('end', () => {
                const params = Object.fromEntries(new URLSearchParams(data));
                posts.push(params);
                const body = opts.onPost ? opts.onPost(params) : { result: '0' };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            });
            return;
        }

        res.writeHead(404);
        res.end('not found');
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
            resolve({
                client: new ZteClient(`127.0.0.1:${port}`, { timeout: 2000 }),
                close: () => new Promise(r => server.close(() => r())),
                posts,
            });
        });
    });
}

describe('lib/zteClient', () => {
    describe('crypto helpers', () => {
        const client = new ZteClient('127.0.0.1');

        it('_sha256Upper returns an uppercase hex digest', () => {
            const out = client._sha256Upper('test');
            expect(out).to.equal(crypto.createHash('sha256').update('test', 'utf8').digest('hex').toUpperCase());
            expect(out).to.match(/^[0-9A-F]{64}$/);
        });

        it('_md5Lower and _md5Upper agree except for case', () => {
            expect(client._md5Lower('x')).to.equal(client._md5Upper('x').toLowerCase());
            expect(client._md5Lower('x')).to.match(/^[0-9a-f]{32}$/);
        });
    });

    describe('getField', () => {
        let mock;
        afterEach(() => mock && mock.close());

        it('returns the field value as a string', async () => {
            mock = await startMockRouter({ values: { LD: 'ABCDEF' } });
            expect(await mock.client.getField('LD')).to.equal('ABCDEF');
        });

        it('returns an empty string for a missing field', async () => {
            mock = await startMockRouter({ values: {} });
            expect(await mock.client.getField('nope')).to.equal('');
        });
    });

    describe('getSignal', () => {
        let mock;
        afterEach(() => mock && mock.close());

        it('returns every requested cmd as a string map', async () => {
            mock = await startMockRouter({
                values: { network_lte_rsrp: '-95', Z5g_rsrp: '', network_type: 'ENDC' },
            });
            const raw = await mock.client.getSignal(['network_lte_rsrp', 'Z5g_rsrp', 'network_type']);
            expect(raw).to.deep.equal({
                network_lte_rsrp: '-95',
                Z5g_rsrp: '',
                network_type: 'ENDC',
            });
        });
    });

    describe('login', () => {
        let mock;
        afterEach(() => mock && mock.close());

        it('sends the expected password hash and AD token on result=0', async () => {
            const values = {
                cr_version: 'CR1',
                wa_inner_version: 'WA2',
                LD: 'LDSALT',
                RD: 'RDSALT',
            };
            mock = await startMockRouter({ values, onPost: () => ({ result: '0' }) });

            await mock.client.login('admin', 'secret');

            expect(mock.posts).to.have.lengthOf(1);
            const post = mock.posts[0];
            expect(post.goformId).to.equal('LOGIN_MULTI_USER');
            expect(post.user).to.equal('admin');

            // Recompute the expected hashes the same way the client should.
            const c = mock.client;
            const expectedPw = c._sha256Upper(c._sha256Upper('secret') + values.LD);
            const expectedAd = c._md5Upper(c._md5Lower(values.cr_version + values.wa_inner_version) + values.RD);
            expect(post.password).to.equal(expectedPw);
            expect(post.AD).to.equal(expectedAd);
        });

        it('throws on a wrong password (result=1)', async () => {
            mock = await startMockRouter({ values: {}, onPost: () => ({ result: '1' }) });
            await expect(mock.client.login('admin', 'bad')).to.be.rejectedWith(/result=1/);
        });

        it('flags sessionBusy when the router is busy (result=3)', async () => {
            mock = await startMockRouter({ values: {}, onPost: () => ({ result: '3' }) });
            let err;
            try {
                await mock.client.login('admin', 'pw');
            } catch (e) {
                err = e;
            }
            expect(err, 'expected login to throw').to.be.an('error');
            expect(err.sessionBusy).to.equal(true);
            expect(err.result).to.equal('3');
        });
    });

    describe('logout', () => {
        let mock;
        afterEach(() => mock && mock.close());

        it('posts a LOGOUT and clears the cookie', async () => {
            mock = await startMockRouter({ values: { LD: 'x' } });
            await mock.client.getField('LD'); // sets the cookie from Set-Cookie
            expect(mock.client.cookie).to.be.a('string');

            await mock.client.logout();
            expect(mock.posts.some(p => p.goformId === 'LOGOUT')).to.equal(true);
            expect(mock.client.cookie).to.equal(null);
        });
    });
});
