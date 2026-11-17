import { total } from './index.mjs';
try { console.log(total(process.argv.slice(2).map(Number))); }
catch { console.error('Use finite numbers.'); process.exitCode = 2; }
