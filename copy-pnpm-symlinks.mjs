#!/usr/bin/env node
/**
 * copy-pnpm-symlinks — re-create pnpm's node_modules symlinks (packages and
 * scoped sub-packages pointing into .pnpm) inside a Next.js standalone output
 * directory, since NFT tracing copies real files but doesn't wire up pnpm's
 * symlink layout on its own.
 *
 * Usage:
 *   copy-pnpm-symlinks [src_node_modules] [dst_node_modules]
 *
 * Every node_modules directory is processed: the root one, plus the
 * per-package ones inside .pnpm (and any nested node_modules below those).
 * For every symlink directly under such a directory (including one level into
 * scoped @scope directories), if the link's target also exists relative to the
 * destination, the same symlink is (re)created there.
 *
 * Defaults:
 *   - No args: src=node_modules, dst=.next/standalone/node_modules
 *   - One arg: it's the dst dir, src=node_modules
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

let [, , src, dst] = process.argv;

if (src && !dst) {
  dst = src;
  src = 'node_modules';
} else if (!src && !dst) {
  src = 'node_modules';
  dst = '.next/standalone/node_modules';
}

if (!fs.existsSync(src)) {
  console.error(`Source directory does not exist: ${src}`);
  process.exit(1);
}

if (!fs.existsSync(dst)) {
  console.error(`Destination directory does not exist: ${dst}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDirectory(p) {
  return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * Collect the node_modules directories to wire up, as paths relative to the
 * roots. The destination supplies the folder structure — only packages that
 * were actually copied are worth linking — while the source decides which of
 * those folders own a node_modules: a copied package may hold nothing but
 * traced files, so the destination need not have that directory yet.
 *
 * Only real directories are walked; symlinks are never followed, so pnpm's
 * link layout can't send us in circles.
 */
function findNodeModuleDirs(srcRoot, dstRoot) {
  const found = [];
  const stack = [''];

  while (stack.length > 0) {
    const rel = stack.pop();

    let entries;
    try {
      entries = fs.readdirSync(path.join(dstRoot, rel), { withFileTypes: true });
    } catch {
      continue;
    }

    const nodeModules = path.join(rel, 'node_modules');
    if (rel !== '' && isDirectory(path.join(srcRoot, nodeModules))) found.push(nodeModules);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // Dirent.isDirectory() is false for symlinks
      stack.push(path.join(rel, entry.name));
    }
  }

  return found;
}

/** Re-create the symlinks of a single node_modules directory. */
function linkNodeModules(srcDir, dstDir) {
  for (const name of fs.readdirSync(srcDir)) {
    if (name === '.pnpm') continue;

    const srcPath = path.join(srcDir, name);
    const isScope = name.startsWith('@') && fs.lstatSync(srcPath).isDirectory();

    const items = isScope ? fs.readdirSync(srcPath).map((sub) => path.join(name, sub)) : [name];

    for (const item of items) {
      const itemPath = path.join(srcDir, item);

      if (fs.lstatSync(itemPath).isSymbolicLink()) {
        const dstPath = path.join(dstDir, item);
        const target = fs.readlinkSync(itemPath);

        if (fs.existsSync(path.resolve(path.dirname(dstPath), target))) {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.rmSync(dstPath, { recursive: true, force: true });
          fs.symlinkSync(target, dstPath);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// '' is the root node_modules pair itself; missing destination directories are
// created on demand, as each link is written.
for (const rel of ['', ...findNodeModuleDirs(src, dst)]) {
  linkNodeModules(path.join(src, rel), path.join(dst, rel));
}
