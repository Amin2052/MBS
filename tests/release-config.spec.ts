import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

test('development key is explicitly marked non-production', () => {
  const file = fs.readFileSync(
    path.join(root, 'electron/main/license-v2/keys/trusted-keys.ts'),
    'utf8'
  );
  expect(file).toContain('Development/testing key only');
});

test('release build scripts exist', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['dist:win']).toBeTruthy();
});
