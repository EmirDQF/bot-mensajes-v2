#!/usr/bin/env node
import prospector from '../services/prospectorService.js';

(async () => {
  try {
    console.log('Running prospector...');
    const stats = await prospector.runProspector();
    console.log('Prospector finished:', stats);
    process.exit(0);
  } catch (e) {
    console.error('Prospector failed:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
