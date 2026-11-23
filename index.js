#!/usr/bin/env node
/**
 * STC Java Bootstrapper — Standard Template Construct
 *
 * A dynamic Java Spring Boot project bootstrapper. Prompts for project name,
 * package (groupId), artifact, user fields, Java version and MySQL config,
 * then auto-generates a full Java project using a reference Spring Boot
 * template (all names/paths/package names are replaced dynamically).
 *
 * Usage:
 *   node index.js                    # bootstrap a new project
 *   node index.js crud:add <dir>     # add CRUD for a new entity to an existing project
 *   npm start
 */

const fs = require('fs');
const path = require('path');

const { ask, close } = require('./lib/prompts');
const { toPascalCase, javaType } = require('./lib/utils');
const {
  REF_PACKAGE_PATH,
  REF_MAIN_CLASS,
  REF_JAVA_VERSION,
  REF_SB_VERSION,
  PL,
  replaceTokens,
  generateUserJava,
} = require('./lib/templates');
const { copyRecursive, repackageDir, walk } = require('./lib/files');
const { generateCrudForEntity } = require('./lib/crud');
const { generateThymeleafListings } = require('./lib/thymeleaf');
const { generateAdmin } = require('./lib/admin');
const { buildSummary } = require('./lib/summary');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/** Bootstrap a new Java Spring Boot project interactively. */
async function main() {
  console.log('==================================================');
  console.log('  STC Java Bootstrapper — Dynamic Spring Boot Project');
  console.log('==================================================\n');

  // ---------------- Prompts ----------------
  const defaultParent = 'D:\\JAVA STC\\java stc';
  const parentDir = (await ask(`Parent directory [${defaultParent}]:`)) || defaultParent;
  const projectName = await ask('Project / folder name (e.g. my-app):');
  if (!projectName) {
    console.error('\n[ERROR] Project / folder name is required.');
    process.exit(1);
  }

  const artifactId = (await ask(`Maven artifactId [${projectName}]:`)) || projectName;
  const groupId = (await ask('Maven groupId (e.g. com.acme):') || 'com.example');
  const version = (await ask(`Version [0.0.1-SNAPSHOT]:`)) || '0.0.1-SNAPSHOT';
  const javaVersion = (await ask(`Java version [21]:`)) || '21';
  const springBootVersion = (await ask(`Spring Boot version [4.1.2]:`)) || '4.1.2';

  console.log('\nCustom entity fields — enter one per line as name:type.');
  console.log('  Types: string, int, long, boolean, double, bigdecimal, instant');
  console.log('  Example: phone:string  age:int  subscribed:boolean');
  console.log('  Blank line to finish.\n');
  const fields = [];
  while (true) {
    const f = await ask('  field:');
    if (!f) break;
    const m = f.match(/^([A-Za-z_][A-Za-z0-9_]*)\:([A-Za-z]+)$/);
    if (!m) {
      console.log('    (skipped invalid)');
      continue;
    }
    fields.push({ name: m[1], type: m[2] });
  }

  const artifactUs = artifactId.replace(/-/g, '_');
  const defaultDb = `${artifactUs}_dev`;
  const dbName = (await ask(`MySQL database name [${defaultDb}]:`)) || defaultDb;
  const dbHost = (await ask('MySQL host [localhost]:') || 'localhost');
  const dbPort = (await ask('MySQL port [3306]:') || '3306');
  const dbUser = (await ask('MySQL username [root]:') || 'root');
  const dbPassword = await ask('MySQL password []:');

  // ---------------- Derived values ----------------
  const packageName = groupId + '.' + artifactUs;   // e.g. com.acme.my_app
  const packagePath = groupId.replace(/\./g, '/') + '/' + artifactUs; // e.g. com/acme/my_app
  const mainClass = toPascalCase(artifactId) + 'Application'; // e.g. MyAppApplication
  const targetDir = path.join(parentDir, projectName);

  // ---------------- Replacement tokens (placeholders -> dynamic values) ----------------
  const repls = [
    [PL.PKG, packageName],
    [PL.PKGPATH, packagePath],
    [PL.GROUP, groupId],
    [PL.TITLE, projectName],
    [PL.ARTIFACT, artifactId],
    [PL.ARTUS, artifactUs],
    [PL.MAIN, mainClass],
    [PL.TESTS, mainClass + 'Tests'],
    [PL.VER, version],
    [PL.JWT, `${artifactId}-secret-change-in-production`],
    [PL.ADMINEMAIL, `admin@${artifactUs}.com`],
    [PL.DBDEV, `jdbc:mysql://${dbHost}:${dbPort}/${dbName}?createDatabaseIfNotExist=true`],
    [PL.DBQA, `jdbc:mysql://qa-db-host:3306/${dbName}_qa?createDatabaseIfNotExist=true`],
    [PL.DBPROD, `jdbc:mysql://prod-db-host:3306/${dbName}?createDatabaseIfNotExist=true`],
  ];

  // ---------------- Copy templates ----------------
  if (fs.existsSync(targetDir)) {
    console.error(`\n[ERROR] Target directory already exists: ${targetDir}`);
    process.exit(1);
  }
  console.log(`\nCopying template from ${TEMPLATES_DIR} -> ${targetDir} ...`);
  copyRecursive(TEMPLATES_DIR, targetDir);

  // ---------------- Repackage Java directories ----------------
  const javaSrc = path.join(targetDir, 'src', 'main', 'java');
  const javaTest = path.join(targetDir, 'src', 'test', 'java');
  const refSrcDir = path.join(javaSrc, REF_PACKAGE_PATH);
  const refTestDir = path.join(javaTest, REF_PACKAGE_PATH);
  const targetSrcDir = path.join(javaSrc, packagePath);
  const targetTestDir = path.join(javaTest, packagePath);

  repackageDir(refSrcDir, targetSrcDir);
  repackageDir(refTestDir, targetTestDir);

  // Safety: remove any leftover reference package dirs so stale/unreplaced
  // templates can never end up compiled on the classpath.
  for (const leftover of [refSrcDir, refTestDir]) {
    if (fs.existsSync(leftover)) fs.rmSync(leftover, { recursive: true, force: true });
  }

  // ---------------- Rename main class + test files ----------------
  function renameFile(dir, oldName, newName) {
    const oldP = path.join(dir, oldName);
    const newP = path.join(dir, newName);
    if (fs.existsSync(oldP)) fs.renameSync(oldP, newP);
  }
  renameFile(targetSrcDir, `${PL.MAIN}.java`, `${mainClass}.java`);
  renameFile(targetTestDir, `${PL.TESTS}.java`, `${mainClass}Tests.java`);

  // ---------------- Process file contents (token replacement) ----------------
  const userJavaPath = path.join(targetSrcDir, 'model', 'User.java');

  walk(targetDir, (file) => {
    if (file === userJavaPath) return; // regenerated below
    const ext = path.extname(file);
    if (ext !== '.java' && ext !== '.xml' && ext !== '.properties' &&
        ext !== '.gitignore' && ext !== '.cmd' && ext !== '') {
      return;
    }
    if (file.endsWith('.jar')) return;
    let content = fs.readFileSync(file, 'utf8');
    if (path.basename(file) === 'pom.xml') {
      content = content.replace(
        `<java.version>${REF_JAVA_VERSION}</java.version>`,
        `<java.version>${javaVersion}</java.version>`
      );
      content = content.replace(
        `<version>${REF_SB_VERSION}</version>`,
        `<version>${springBootVersion}</version>`
      );
    }
    content = replaceTokens(content, repls);
    fs.writeFileSync(file, content, 'utf8');
  });

  // ---------------- Regenerate User.java with custom fields ----------------
  fs.writeFileSync(userJavaPath, generateUserJava(packageName, fields), 'utf8');

  // ---------------- Auto-generate CRUD for the entity ----------------
  generateCrudForEntity(targetDir, 'User', fields);

  // ---------------- Auto-generate Thymeleaf paginated listings for all @Entity models ----------------
  generateThymeleafListings(targetDir);

  // ---------------- Auto-generate Django-like admin (/db) for all @Entity models ----------------
  generateAdmin(targetDir);

  // ---------------- Write SUMMARY.md ----------------
  const summary = buildSummary({
    projectName, groupId, artifactId, version, javaVersion, springBootVersion,
    packageName, mainClass, dbName, dbHost, dbPort, dbUser, artifactUs, fields, javaType,
  });
  fs.writeFileSync(path.join(targetDir, 'STC-SUMMARY.md'), summary, 'utf8');

  console.log(`\n==================================================`);
  console.log(`  DONE — project generated at:`);
  console.log(`  ${targetDir}`);
  console.log(`==================================================\n`);
  console.log(summary);
}

/* ========================================================================
   crud:add — add CRUD for a new entity to an already-generated project
   Usage: node index.js crud:add <projectDir>
   ======================================================================== */
async function crudAddMode(projectDirArg) {
  let projectDir = projectDirArg;
  if (!projectDir) {
    projectDir = (await ask('Path to existing project directory:')) || '';
    projectDir = projectDir.replace(/^"(.*)"$/, '$1'); // strip surrounding quotes
  }
  if (!projectDir || !fs.existsSync(projectDir)) {
    console.error('\n[ERROR] Project directory not found.');
    process.exit(1);
  }

  const { detectPackage } = require('./lib/crud');
  const packageName = detectPackage(projectDir);
  if (!packageName) {
    console.error('\n[ERROR] Could not detect Java package in the project.');
    process.exit(1);
  }
  console.log('\nDetected package: ' + packageName);

  const entityName = (await ask('Entity name (e.g. Order, Customer, Product):')) || '';
  if (!entityName) {
    console.error('\n[ERROR] Entity name is required.');
    process.exit(1);
  }
  // Ensure PascalCase
  const entityPascal = toPascalCase(entityName);

  console.log('\nEntity fields — enter one per line as name:type.');
  console.log('  Types: string, int, long, boolean, double, bigdecimal, instant');
  console.log('  Blank line to finish.\n');
  const fields = [];
  while (true) {
    const f = await ask('  field:');
    if (!f) break;
    const m = f.match(/^([A-Za-z_][A-Za-z0-9_]*)\:([A-Za-z]+)$/);
    if (!m) {
      console.log('    (skipped invalid)');
      continue;
    }
    fields.push({ name: m[1], type: m[2] });
  }

  generateCrudForEntity(projectDir, entityPascal, fields);
  generateThymeleafListings(projectDir);
  generateAdmin(projectDir);
  console.log('\n[DONE] CRUD added for entity: ' + entityPascal);
}

/* ========================================================================
   th:add — (re)generate Thymeleaf paginated listings for all @Entity models
   Usage: node index.js th:add <projectDir>
   ======================================================================== */
async function thAddMode(projectDirArg) {
  let projectDir = projectDirArg;
  if (!projectDir) {
    projectDir = (await ask('Path to existing project directory:')) || '';
    projectDir = projectDir.replace(/^"(.*)"$/, '$1');
  }
  if (!projectDir || !fs.existsSync(projectDir)) {
    console.error('\n[ERROR] Project directory not found.');
    process.exit(1);
  }
  generateThymeleafListings(projectDir);
  generateAdmin(projectDir);
}

const argv = process.argv.slice(2);
if (argv[0] === 'th:add' || argv[0] === 'thymeleaf:add') {
  thAddMode(argv[1]).then(() => close()).catch((err) => {
    close();
    console.error('\n[FATAL]', err.message);
    process.exit(1);
  });
} else if (argv[0] === 'crud:add') {
  crudAddMode(argv[1]).then(() => close()).catch((err) => {
    close();
    console.error('\n[FATAL]', err.message);
    process.exit(1);
  });
} else {
  main().then(() => close()).catch((err) => {
    close();
    console.error('\n[FATAL]', err.message);
    process.exit(1);
  });
}
