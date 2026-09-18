#!/usr/bin/env node
/**
 * 离线装配 deb：基于 electron-builder 产物 dist/<arch>-unpacked，用系统 dpkg-deb 打包。
 * 不走 electron-builder 的 deb 目标——其依赖的 fpm 工具需从 github 下载（内网不可达）且仅 x86 版。
 * 在 npm run package 后自动执行；缺 dpkg-deb 的环境跳过并提示。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { version, description = '', author, homepage = '' } = pkg;
const productName = pkg.build?.productName || pkg.name; // 应用名（/opt/gitid、.desktop）
const execName = pkg.name; // unpacked 内的可执行文件名（electron-builder 按 package.name 生成）
const maintainer = typeof author === 'string'
  ? author
  : `${author.name} <${author.email || 'unknown@example.com'}>`;

const unpacked = path.join(root, 'dist', 'linux-arm64-unpacked');
const dist = path.join(root, 'dist');
const installDir = `/opt/${productName}`;
const debPath = path.join(dist, `${productName}_${version}_arm64.deb`);

if (!fs.existsSync(path.join(unpacked, execName))) {
  console.error(`[make-deb] 缺少 ${unpacked}（含 ${execName}）——请先运行 npm run package`);
  process.exit(1);
}
if (spawnSync('which', ['dpkg-deb']).status !== 0) {
  console.error('[make-deb] 未找到 dpkg-deb（非 deb 系系统），跳过 deb 打包');
  process.exit(0);
}

const staging = path.join(dist, '.deb-staging');
fs.rmSync(staging, { recursive: true, force: true });
// 全部用相对段，路径统一在这里 join（path.join 遇绝对段会直接拼接，勿混入绝对路径）
for (const rel of ['DEBIAN', installDir.slice(1), 'usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/512x512/apps']) {
  fs.mkdirSync(path.join(staging, rel), { recursive: true });
}

// 应用本体
fs.cpSync(unpacked, path.join(staging, installDir.slice(1)), { recursive: true });
// 命令行入口 + 图标 + 桌面入口
fs.symlinkSync(path.join(installDir, execName), path.join(staging, 'usr/bin', productName));
fs.copyFileSync(
  path.join(root, 'build', 'icon.png'),
  path.join(staging, 'usr/share/icons/hicolor/512x512/apps', `${productName}.png`),
);
fs.writeFileSync(path.join(staging, 'usr/share/applications', `${productName}.desktop`), [
  '[Desktop Entry]',
  `Name=${productName}`,
  `Comment=${description.split('\n')[0]}`,
  `Exec=/usr/bin/${productName}`,
  `Icon=${productName}`,
  'Type=Application',
  'Categories=Development;',
  `StartupWMClass=${productName}`,
  '',
].join('\n'));

const controlLines = [
  `Package: ${productName.toLowerCase()}`,
  `Version: ${version}`,
  'Section: devel',
  'Priority: optional',
  'Architecture: arm64',
  `Maintainer: ${maintainer}`,
  'Depends: libgtk-3-0, libnotify4, libnss3, libxtst6, libatspi2.0-0, libdrm2, libgbm1, libasound2',
  `Description: ${description.split('\n')[0]}`,
];
if (homepage) controlLines.push(` ${productName} 主页：${homepage}`);
fs.writeFileSync(path.join(staging, 'DEBIAN', 'control'), controlLines.join('\n') + '\n');

// --root-owner-group：无需 fakeroot 即可让包内文件属主为 root
const r = spawnSync('dpkg-deb', ['--build', '--root-owner-group', staging, debPath], { stdio: 'inherit' });
fs.rmSync(staging, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`[make-deb] ${debPath}`);
