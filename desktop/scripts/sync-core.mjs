#!/usr/bin/env node
/**
 * 将 cli/lib/core.js 同步为 desktop/main/core.js（打包时随 asar 收录；
 * 开发态若未同步，main/index.js 会回退直接引用 cli 源文件）。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../cli/lib/core.js');
const dst = resolve(here, '../main/core.js');

let code = readFileSync(src, 'utf8');
const banner = '// ⚠️ 本文件由 desktop/scripts/sync-core.mjs 自动生成（源：cli/lib/core.js），请勿手改\n\n';
code = banner + code;
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, code);
console.log(`synced: cli/lib/core.js -> desktop/main/core.js (${code.length} bytes)`);
