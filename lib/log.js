// ArrHub's own log: everything written to the console is also kept in memory for the Logs tab.
// Required first by server.js, so the console is wrapped before anything else logs.
'use strict';

const util = require('util');

const LOG_MAX = 1000;
const logBuf = [];
let logSeq = 0;
for (const [m, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
  const orig = console[m].bind(console);
  console[m] = (...args) => {
    orig(...args);
    try {
      const message = args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : util.inspect(a, { depth: 3 }))
        .join(' ').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, '');
      logBuf.push({ id: ++logSeq, time: new Date().toISOString(), level, message });
      if (logBuf.length > LOG_MAX) logBuf.shift();
    } catch {}
  };
}

module.exports = { logBuf };
