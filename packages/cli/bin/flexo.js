#!/usr/bin/env node

import { main } from '../src/index.js';

main().catch((err) => {
  console.error('\x1b[31m[Flexo Error]\x1b[0m', err.message || err);
  process.exit(1);
});
