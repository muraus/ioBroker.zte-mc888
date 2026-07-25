'use strict';

/**
 * Definition of the primary router fields to query and how to expose them.
 *
 * Field names verified against ZTE MC888 firmware (ENDC / LTE+5G NSA) response.
 *
 * Each entry:
 *   cmd:      raw field name in the router JSON
 *   id:       ioBroker state id (channel.state)
 *   name:     human readable name
 *   type:     'number' | 'string'
 *   role:     ioBroker role
 *   unit:     optional unit string
 *   hexToDec: if true, the raw hex string is additionally converted to a
 *             decimal number in a sibling "<id>Dec" state (matches the router UI)
 *
 * If your firmware differs, enable debug logging on the instance to see the
 * raw JSON and adjust the `cmd` values here.
 */
const FIELDS = [
    // --- general ---
    { cmd: 'network_type', id: 'general.networkType', name: 'Network type', type: 'string', role: 'text' },
    { cmd: 'network_cell_id', id: 'general.cellId', name: 'Cell ID (raw hex)', type: 'string', role: 'text', hexToDec: true },

    // --- LTE primary cell (PCC) ---
    { cmd: 'network_lte_rsrp', id: 'lte.rsrp', name: 'LTE RSRP', type: 'number', role: 'value', unit: 'dBm' },
    { cmd: 'lte_rsrq', id: 'lte.rsrq', name: 'LTE RSRQ', type: 'number', role: 'value', unit: 'dB' },
    { cmd: 'lte_snr', id: 'lte.sinr', name: 'LTE SINR', type: 'number', role: 'value', unit: 'dB' },
    { cmd: 'lte_rssi', id: 'lte.rssi', name: 'LTE RSSI', type: 'number', role: 'value', unit: 'dBm' },
    { cmd: 'network_lte_ca_pcell_band', id: 'lte.band', name: 'LTE band', type: 'string', role: 'text' },
    { cmd: 'network_ZCELLINFO_band', id: 'lte.bandName', name: 'LTE band name', type: 'string', role: 'text' },
    { cmd: 'network_Z_dl_earfcn', id: 'lte.arfcn', name: 'LTE ARFCN (frequency)', type: 'string', role: 'text' },
    { cmd: 'network_lte_ca_pcell_bandwidth', id: 'lte.bandwidth', name: 'LTE bandwidth', type: 'string', role: 'text' },
    { cmd: 'network_Z_PCI', id: 'lte.pci', name: 'LTE PCI (raw hex)', type: 'string', role: 'text', hexToDec: true },
    { cmd: 'wan_lte_ca', id: 'lte.carrierAggregation', name: 'LTE carrier aggregation', type: 'string', role: 'text' },

    // --- 5G NR primary cell (PCC) ---
    { cmd: 'Z5g_rsrp', id: 'nr5g.rsrp', name: '5G RSRP', type: 'number', role: 'value', unit: 'dBm' },
    { cmd: 'Z5g_rsrq', id: 'nr5g.rsrq', name: '5G RSRQ', type: 'number', role: 'value', unit: 'dB' },
    { cmd: 'Z5g_SINR', id: 'nr5g.sinr', name: '5G SINR', type: 'number', role: 'value', unit: 'dB' },
    { cmd: 'Z5g_rssi', id: 'nr5g.rssi', name: '5G RSSI', type: 'number', role: 'value', unit: 'dBm' },
    { cmd: 'nr5g_action_band', id: 'nr5g.band', name: '5G band', type: 'string', role: 'text' },
    { cmd: 'network_Z5g_CELLINFO_band', id: 'nr5g.bandName', name: '5G band name', type: 'string', role: 'text' },
    { cmd: 'nr5g_action_channel', id: 'nr5g.arfcn', name: '5G ARFCN (frequency)', type: 'string', role: 'text' },
    { cmd: 'nr5g_nsa_bandwidth', id: 'nr5g.bandwidth', name: '5G bandwidth', type: 'string', role: 'text' },
    { cmd: 'network_Z5g_PCI', id: 'nr5g.pci', name: '5G PCI (raw hex)', type: 'string', role: 'text', hexToDec: true },
];

// Raw CA fields that need special parsing (handled in main.js, not as plain states).
const CA_FIELDS = {
    // cell layout:  index,pci,?,band,arfcn,bandwidth  (semicolon separated per cell)
    scellInfo: 'lte_multi_ca_scell_info',
    // signal:       rsrp,rsrq,sinr,rssi,...           (semicolon separated per cell)
    scellSig: 'lte_multi_ca_scell_sig_info',
};

// Every raw field the adapter needs to request from the router.
const ALL_CMDS = [
    ...FIELDS.map((f) => f.cmd),
    CA_FIELDS.scellInfo,
    CA_FIELDS.scellSig,
];

module.exports = { FIELDS, CA_FIELDS, ALL_CMDS };
