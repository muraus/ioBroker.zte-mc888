'use strict';

const { expect } = require('chai');
const { FIELDS, CA_FIELDS, ALL_CMDS } = require('./fields');

describe('lib/fields', () => {
    it('exposes a non-empty FIELDS list', () => {
        expect(FIELDS).to.be.an('array').that.is.not.empty;
    });

    it('every field has the required properties', () => {
        for (const f of FIELDS) {
            expect(f, `cmd=${f.cmd}`).to.include.keys('cmd', 'id', 'name', 'type', 'role');
            expect(f.type, `type of ${f.id}`).to.be.oneOf(['number', 'string']);
            expect(f.id, `id of ${f.cmd}`).to.match(/^(general|lte|nr5g)\./);
        }
    });

    it('uses unique state ids and unique cmds', () => {
        const ids = FIELDS.map(f => f.id);
        const cmds = FIELDS.map(f => f.cmd);
        expect(new Set(ids).size, 'duplicate state id').to.equal(ids.length);
        expect(new Set(cmds).size, 'duplicate cmd').to.equal(cmds.length);
    });

    it('only marks string fields as hexToDec', () => {
        for (const f of FIELDS.filter(x => x.hexToDec)) {
            expect(f.type, `${f.id} is hexToDec but not a string`).to.equal('string');
        }
    });

    it('ALL_CMDS contains every field cmd plus the CA fields', () => {
        for (const f of FIELDS) {
            expect(ALL_CMDS, `missing ${f.cmd}`).to.include(f.cmd);
        }
        expect(ALL_CMDS).to.include(CA_FIELDS.scellInfo);
        expect(ALL_CMDS).to.include(CA_FIELDS.scellSig);
        expect(ALL_CMDS).to.have.lengthOf(FIELDS.length + 2);
    });
});
