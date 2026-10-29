import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!html.includes('<html lang="es">')) throw new Error('Missing Spanish document language');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('Missing application script');
for (const [, source] of scripts) new Script(source);
console.log('HTML language and JavaScript syntax verified. Browser behavior requires separate checks.');
