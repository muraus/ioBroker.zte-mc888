'use strict';

const utils = require('@iobroker/adapter-core');
const { ZteClient } = require('./lib/zteClient');
const { FIELDS, CA_FIELDS, ALL_CMDS } = require('./lib/fields');

// Number of LTE secondary carrier cells to expose (scc0 .. scc{N-1}).
const MAX_SCELLS = 4;

// Fields the MC888 only returns on an authenticated read. If any of these
// carries a value we know we currently hold a login session (full data);
// otherwise we only got the public fields and need to log in.
const LOGIN_ONLY_PROBE = ['lte_rsrq', 'lte_snr', 'Z5g_SINR', 'network_Z_PCI', 'network_lte_ca_pcell_band'];

class ZteMc888 extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'zte-mc888',
        });

        this.pollTimer = null;
        /** @type {ZteClient|null} */
        this.client = null;
        this.statesCreated = false;

        // Defaults, overwritten from the instance config in onReady().
        this.pollIntervalMs = 30000;
        this.webUiPriority = true;
        this.graceMs = 5 * 60 * 1000;

        // Session state for the "web UI has priority" handling.
        //   sessionActive  - true while we believe we hold a login session
        //   kickedUntil    - epoch ms until which we back off from re-login
        //                    after our session was taken over (0 = not backing off)
        this.sessionActive = false;
        this.kickedUntil = 0;

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        // Reset connection indicator until the first successful poll.
        await this.setStateAsync('info.connection', { val: false, ack: true });

        const ip = this.config.ip;
        if (!ip) {
            this.log.error('No router IP configured. Please set it in the adapter settings.');
            return;
        }

        let interval = Number(this.config.pollInterval);
        if (!Number.isFinite(interval) || interval < 5) {
            this.log.warn('Poll interval invalid or below 5s, falling back to 30s.');
            interval = 30;
        }
        this.pollIntervalMs = interval * 1000;

        // "Web UI has priority": after our session is taken over by another
        // login (typically the router web UI, same user), wait this long before
        // trying to log in again, so we don't repeatedly kick the web UI out.
        this.webUiPriority = this.config.webUiPriority !== false;
        let grace = Number(this.config.graceMinutes);
        if (!Number.isFinite(grace) || grace < 0) {
            grace = 5;
        }
        this.graceMs = grace * 60 * 1000;

        this.client = new ZteClient(ip, { timeout: 10000 });

        await this.createStates();
        this.statesCreated = true;

        // Kick off polling immediately, then on the configured interval.
        this.poll();
    }

    async createStates() {
        // Channels for grouping.
        const channels = {
            general: 'General',
            lte: 'LTE',
            nr5g: '5G NR',
        };
        for (const [id, name] of Object.entries(channels)) {
            await this.setObjectNotExistsAsync(id, {
                type: 'channel',
                common: { name },
                native: {},
            });
        }

        for (const f of FIELDS) {
            await this.setObjectNotExistsAsync(f.id, {
                type: 'state',
                common: {
                    name: f.name,
                    type: f.type,
                    role: f.role,
                    unit: f.unit,
                    read: true,
                    write: false,
                },
                native: { cmd: f.cmd },
            });

            // Optional decimal sibling for hex-encoded values (matches router UI).
            if (f.hexToDec) {
                await this.setObjectNotExistsAsync(`${f.id}Dec`, {
                    type: 'state',
                    common: {
                        name: `${f.name.replace(' (raw hex)', '')} (decimal)`,
                        type: 'number',
                        role: 'value',
                        read: true,
                        write: false,
                    },
                    native: {},
                });
            }
        }

        // Secondary carrier cells (LTE CA): lte.scc0 .. lte.scc{N-1}
        for (let i = 0; i < MAX_SCELLS; i++) {
            const base = `lte.scc${i}`;
            await this.setObjectNotExistsAsync(base, {
                type: 'channel',
                common: { name: `LTE secondary cell ${i}` },
                native: {},
            });

            /** @type {{id: string, name: string, type: ioBroker.CommonType, role: string, unit?: string}[]} */
            const sccStates = [
                { id: 'active', name: 'Active', type: 'boolean', role: 'indicator', unit: undefined },
                { id: 'pci', name: 'PCI', type: 'number', role: 'value', unit: undefined },
                { id: 'band', name: 'Band', type: 'number', role: 'value', unit: undefined },
                { id: 'arfcn', name: 'ARFCN (frequency)', type: 'number', role: 'value', unit: undefined },
                { id: 'bandwidth', name: 'Bandwidth', type: 'number', role: 'value', unit: 'MHz' },
                { id: 'rsrp', name: 'RSRP', type: 'number', role: 'value', unit: 'dBm' },
                { id: 'rsrq', name: 'RSRQ', type: 'number', role: 'value', unit: 'dB' },
                { id: 'sinr', name: 'SINR', type: 'number', role: 'value', unit: 'dB' },
                { id: 'rssi', name: 'RSSI', type: 'number', role: 'value', unit: 'dBm' },
            ];
            for (const s of sccStates) {
                await this.setObjectNotExistsAsync(`${base}.${s.id}`, {
                    type: 'state',
                    common: {
                        name: `SCC${i} ${s.name}`,
                        type: s.type,
                        role: s.role,
                        unit: s.unit,
                        read: true,
                        write: false,
                    },
                    native: {},
                });
            }
        }
    }

    async poll() {
        if (!this.client) {
            return;
        }
        try {
            // 1) Read with whatever session we currently hold. If we still hold
            //    a login session the router returns the full field set; if we
            //    never logged in (or were kicked) we only get the few public
            //    fields.
            let raw = await this._safeRead();

            // Without login there is nothing more we can do than the public
            // fields, so publish and finish early.
            if (!this.config.useLogin) {
                if (!raw) {
                    throw new Error(
                        'Router did not answer (enable debug logging to see the underlying transport error).',
                    );
                }
                await this._publish(raw, !this._hasFullData(raw));
                return;
            }

            const full = this._hasFullData(raw);

            // 2) Detect that a session we used to hold was taken over by another
            //    login (typically the web UI logging in with the same user).
            if (this.sessionActive && !full) {
                this.sessionActive = false;
                if (this.webUiPriority && this.graceMs > 0) {
                    this.kickedUntil = Date.now() + this.graceMs;
                    this.log.info(
                        'Lost the router session (another login took over, e.g. the web UI). ' +
                            `Backing off for ${Math.round(this.graceMs / 60000)} min before logging in ` +
                            'again so the web UI stays usable. Signal values are kept at their last ' +
                            'value in the meantime.',
                    );
                }
            }

            // 3) (Re-)acquire a session only when we have full-field data missing
            //    AND we are not currently backing off for the web UI.
            const backingOff = this.webUiPriority && this.kickedUntil && Date.now() < this.kickedUntil;

            if (!full && !backingOff) {
                await this.client.login(this.config.user, this.config.password);
                this.sessionActive = true;
                this.kickedUntil = 0;
                raw = await this._safeRead();
            }

            const haveFull = this._hasFullData(raw);
            if (!raw || !this._hasSignalData(raw)) {
                throw new Error(
                    'Router returned no signal data. Check credentials and field ' +
                        'names (enable debug logging to see the raw response).',
                );
            }

            // Publish. During a back-off / partial read we only update the
            // fields that actually carry a value and keep the rest untouched.
            await this._publish(raw, !haveFull);
        } catch (e) {
            if (e.sessionBusy) {
                this.sessionActive = false;
                if (this.webUiPriority && this.graceMs > 0) {
                    this.kickedUntil = Date.now() + this.graceMs;
                }
                this.log.info(
                    'Router reports another active login (result=3). Skipping this poll ' +
                        'and retrying later without kicking the other session.',
                );
            } else {
                this.log.warn(`Poll failed: ${e.message}`);
            }
            await this.setStateChangedAsync('info.connection', { val: false, ack: true });
        } finally {
            if (!this.unloaded) {
                this.pollTimer = this.setTimeout(() => this.poll(), this.pollIntervalMs);
            }
        }
    }

    /**
     * Read all fields, swallowing transport errors into a null result so the
     * caller can decide how to proceed (login / back off / fail).
     *
     * @returns {Promise<Record<string,string>|null>} the raw router response, or null when the read failed
     */
    async _safeRead() {
        if (!this.client) {
            return null;
        }
        try {
            return await this.client.getSignal(ALL_CMDS);
        } catch (e) {
            this.log.debug(`Read failed: ${e.message}`);
            return null;
        }
    }

    /**
     * Apply values and update the connection indicator.
     *
     * @param {Record<string,string>} raw the raw router response
     * @param {boolean} partial  when true, empty fields are left untouched
     *                           (keep last value) instead of being cleared
     */
    async _publish(raw, partial) {
        if (this.log.level === 'debug' || this.log.level === 'silly') {
            this.log.debug(`Raw router response${partial ? ' (partial)' : ''}: ${JSON.stringify(raw)}`);
        }
        await this.applyValues(raw, partial);
        await this.applySecondaryCells(raw, partial);
        await this.setStateChangedAsync('info.connection', { val: true, ack: true });
    }

    /**
     * Write all scalar fields from the raw response into their states.
     *
     * @param {Record<string,string>} raw the raw router response
     * @param {boolean} [partial] when true, empty fields keep their last value instead of being cleared
     */
    async applyValues(raw, partial = false) {
        for (const f of FIELDS) {
            const rawVal = raw[f.cmd];
            if (rawVal === undefined) {
                continue;
            }

            // On a partial (unauthorized) read the login-only fields come back
            // empty. Keep their last known value instead of clearing them.
            if (partial && (rawVal === '' || rawVal === null)) {
                continue;
            }

            let val;
            if (f.type === 'number') {
                if (rawVal === '' || rawVal === null) {
                    val = null;
                } else {
                    const n = Number(rawVal);
                    val = Number.isFinite(n) ? n : null;
                }
            } else {
                val = rawVal === null ? '' : String(rawVal);
            }

            await this.setStateChangedAsync(f.id, { val, ack: true });

            // Write decimal sibling for hex values.
            if (f.hexToDec) {
                const dec = this._hexToDec(rawVal);
                await this.setStateChangedAsync(`${f.id}Dec`, { val: dec, ack: true });
            }
        }
    }

    /**
     * Parse the LTE carrier-aggregation secondary cell fields into scc0..sccN states.
     *
     * lte_multi_ca_scell_info format (per cell, ';' separated):
     *     index,pci,?,band,arfcn,bandwidth
     * lte_multi_ca_scell_sig_info format (per cell, ';' separated):
     *     rsrp,rsrq,sinr,rssi,?,active
     *
     * @param {Record<string,string>} raw the raw router response
     * @param {boolean} [partial] when true, empty CA fields keep their last value instead of being cleared
     */
    async applySecondaryCells(raw, partial = false) {
        const infoRaw = raw[CA_FIELDS.scellInfo] || '';
        const sigRaw = raw[CA_FIELDS.scellSig] || '';

        // On a partial (unauthorized) read the CA fields are empty. Don't clear
        // the secondary-cell states; keep their last known values.
        if (partial && !infoRaw && !sigRaw) {
            return;
        }

        const infoCells = infoRaw
            .split(';')
            .map(c => c.trim())
            .filter(c => c.length);
        const sigCells = sigRaw
            .split(';')
            .map(c => c.trim())
            .filter(c => c.length);

        for (let i = 0; i < MAX_SCELLS; i++) {
            const base = `lte.scc${i}`;
            const info = infoCells[i] ? infoCells[i].split(',') : null;
            const sig = sigCells[i] ? sigCells[i].split(',') : null;

            if (!info && !sig) {
                // No data for this slot -> mark inactive, clear values.
                await this.setStateChangedAsync(`${base}.active`, { val: false, ack: true });
                continue;
            }

            const active = sig && sig[5] !== undefined ? sig[5].trim() === '1' : Boolean(info);
            await this.setStateChangedAsync(`${base}.active`, { val: active, ack: true });

            if (info) {
                // index,pci,?,band,arfcn,bandwidth
                await this.setStateChangedAsync(`${base}.pci`, { val: this._num(info[1]), ack: true });
                await this.setStateChangedAsync(`${base}.band`, { val: this._num(info[3]), ack: true });
                await this.setStateChangedAsync(`${base}.arfcn`, { val: this._num(info[4]), ack: true });
                await this.setStateChangedAsync(`${base}.bandwidth`, { val: this._num(info[5]), ack: true });
            }

            if (sig) {
                // rsrp,rsrq,sinr,rssi,...
                await this.setStateChangedAsync(`${base}.rsrp`, { val: this._num(sig[0]), ack: true });
                await this.setStateChangedAsync(`${base}.rsrq`, { val: this._num(sig[1]), ack: true });
                await this.setStateChangedAsync(`${base}.sinr`, { val: this._num(sig[2]), ack: true });
                await this.setStateChangedAsync(`${base}.rssi`, { val: this._num(sig[3]), ack: true });
            }
        }
    }

    /**
     * Decide whether a raw router response actually carries usable signal data.
     *
     * Used to tell "read succeeded without login" apart from "router answered
     * but withheld the values because we are not authenticated". We probe the
     * numeric signal fields (RSRP/RSRQ/... ) since those are only populated on
     * a real, authorized read.
     *
     * @param {Record<string,string>|null} raw the raw router response
     * @returns {boolean} true if at least one numeric signal field carries a value
     */
    _hasSignalData(raw) {
        if (!raw) {
            return false;
        }
        const probes = FIELDS.filter(f => f.type === 'number').map(f => f.cmd);
        return probes.some(cmd => raw[cmd] !== undefined && String(raw[cmd]).trim() !== '');
    }

    /**
     * Decide whether the response is a full, authorized read.
     *
     * On the MC888 only a handful of fields (network type + the primary RSRP/
     * RSSI values) are returned without login; everything else (RSRQ, SINR,
     * bands, PCI, carrier aggregation, ...) requires an authenticated session.
     * If any of those login-only fields carries a value, we hold a session.
     *
     * @param {Record<string,string>|null} raw the raw router response
     * @returns {boolean} true if a login-only field carries a value, i.e. we hold a session
     */
    _hasFullData(raw) {
        if (!raw) {
            return false;
        }
        return LOGIN_ONLY_PROBE.some(cmd => raw[cmd] !== undefined && String(raw[cmd]).trim() !== '');
    }

    /**
     * Convert a raw router value into a number.
     *
     * @param {string|null|undefined} v raw value
     * @returns {number|null} the number, or null for empty/non-numeric input
     */
    _num(v) {
        if (v === undefined || v === null || String(v).trim() === '') {
            return null;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Convert a hex string from the router into a decimal number.
     *
     * @param {string|null|undefined} v raw hex value, e.g. a cell id
     * @returns {number|null} the decimal value, or null for empty/non-hex input
     */
    _hexToDec(v) {
        if (v === undefined || v === null || String(v).trim() === '') {
            return null;
        }
        const n = parseInt(String(v).trim(), 16);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Stop polling when the instance is unloaded.
     *
     * @param {() => void} callback must be called when the cleanup is done
     */
    onUnload(callback) {
        try {
            this.unloaded = true;
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new ZteMc888(options);
} else {
    new ZteMc888();
}
