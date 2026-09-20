import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNetworkDiagnostics } from '../js/release-safety.js';

test('network counters alone cannot masquerade as measured zero packet loss', () => {
    assert.equal(formatNetworkDiagnostics(0.1, { peers: 1, ping: 42, sent: 100, received: 100 }), '10 FPS | 42ms | LOSS N/A | 1P');
    assert.match(formatNetworkDiagnostics(1 / 60, { peers: 2, ping: 31, packetLoss: 0 }), /60 FPS.*0% LOSS/);
    assert.match(formatNetworkDiagnostics(1 / 30, { peers: 2, ping: 31, packetLoss: 0.12 }), /30 FPS.*12% LOSS/);
});

test('frame diagnostics use actual elapsed time, including a stalled frame', () => {
    assert.equal(formatNetworkDiagnostics(0.5), '2 FPS | LOCAL');
    assert.equal(formatNetworkDiagnostics(0), '0 FPS | LOCAL');
    assert.equal(formatNetworkDiagnostics(NaN, { peers: 1 }), '0 FPS | PING N/A | LOSS N/A | 1P');
});
