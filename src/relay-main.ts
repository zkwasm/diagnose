#!/usr/bin/env node
import { createRelay } from './relay.js';
const relay = createRelay({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8792), downloadPath: process.env.DOWNLOAD_PATH });
relay.listen().then(() => console.log('diagnose-relay ready')).catch(() => { console.error('RELAY_START_FAILED'); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void relay.close(); });
