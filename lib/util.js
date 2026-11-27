// Small helpers shared by several modules
'use strict';

const hashId = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

const sleep = ms => new Promise(r => setTimeout(r, ms));

const coverMap = new Map(); // id -> { svc, local, remote, kind }

module.exports = { hashId, coverMap, sleep };
