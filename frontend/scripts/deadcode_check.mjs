import { execSync } from 'node:child_process';

const targetPrefixes = [
  'src/features/viewer/app/',
  'src/features/viewer/infra/',
  'src/features/viewer/domain/',
];

const normalizePath = (line) => line.replaceAll('\\', '/');

let output = '';
try {
  output = execSync('npx ts-prune -p tsconfig.json', { encoding: 'utf8' });
} catch (error) {
  output = error.stdout?.toString() ?? '';
}

const lines = output
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map(normalizePath)
  .filter((line) => targetPrefixes.some((prefix) => line.includes(prefix)));

if (lines.length > 0) {
  console.error('Dead code detected in viewer core modules:');
  lines.forEach((line) => console.error(line));
  process.exit(1);
}

console.log('Dead code check passed for viewer core modules.');
