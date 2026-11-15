const fs = require('fs');
const path = require('path');

/** Copy a directory recursively. */
function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Walk a directory tree and call cb(filePath) for each file. */
function walk(dir, cb) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

/** Collect all files under a directory recursively (returns array of paths). */
function walkSyncFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkSyncFiles(p));
    else results.push(p);
  }
  return results;
}

/** Move/repackage a directory tree from refDir to targetDir2. */
function repackageDir(refDir, targetDir2) {
  if (!fs.existsSync(refDir)) return;
  fs.mkdirSync(targetDir2, { recursive: true });
  copyRecursive(refDir, targetDir2);
  fs.rmSync(refDir, { recursive: true, force: true });
  // Remove now-empty parent dirs (e.g. com/example, com) inside src/main/java
  const javaRoot = path.resolve(path.join(targetDir2, '..', '..', '..', '..'));
  let up = path.dirname(refDir);
  while (up.startsWith(javaRoot) && up !== javaRoot) {
    try {
      if (fs.readdirSync(up).length === 0) fs.rmdirSync(up);
    } catch (e) {
      break;
    }
    up = path.dirname(up);
  }
}

module.exports = { copyRecursive, walk, walkSyncFiles, repackageDir };
