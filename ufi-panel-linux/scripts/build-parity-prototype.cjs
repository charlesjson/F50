'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../docs/full-parity');
const template = fs.readFileSync(path.join(root, 'prototype/index.html'), 'utf8');
const result = template
  .replace('/*STYLES*/', () => fs.readFileSync(path.join(root, 'prototype/style.css'), 'utf8'))
  .replace('/*CATALOG*/', () => fs.readFileSync(path.join(root, 'feature-catalog.json'), 'utf8').replaceAll('</', '<\\/'))
  .replace('/*SCRIPT*/', () => fs.readFileSync(path.join(root, 'prototype/app.js'), 'utf8'));
fs.writeFileSync(path.join(root, 'INTERACTION-PROTOTYPE.html'), result);
console.log('Built docs/full-parity/INTERACTION-PROTOTYPE.html');
