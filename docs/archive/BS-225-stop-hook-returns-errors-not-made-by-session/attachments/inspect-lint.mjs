import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [source, root] = process.argv.slice(2);
const { loadProject } = await import(pathToFileURL(path.join(source, 'lib/config.js')));
const { lintProject } = await import(pathToFileURL(path.join(source, 'lib/lint.js')));
process.stdout.write(`${JSON.stringify(lintProject(loadProject(root)), null, 2)}\n`);
