'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registry } = require('../App/Web/core.js');

const target = path.join(__dirname, '../docs/command-catalog.json');
const catalog = {
  format: 'mapchart-command-catalog',
  version: 1,
  count: registry.length,
  commands: registry.map(({ id, title, category, description, example, readOnly }) => ({
    id, title, category, description, example, readOnly
  }))
};
const content = JSON.stringify(catalog, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
    console.error('Command catalog differs from the registered command definitions.');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(target, content);
  console.log(`Wrote ${catalog.count} command entries.`);
}
