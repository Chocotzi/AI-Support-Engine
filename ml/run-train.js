// `npm run train`: ejecuta ml/train.py con el Python del entorno virtual ml/.venv,
// sin tener que activarlo (en PowerShell, Activate.ps1 suele estar bloqueado).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const venvPython = process.platform === 'win32' ? 'ml/.venv/Scripts/python.exe' : 'ml/.venv/bin/python';
const python = existsSync(venvPython) ? venvPython : 'python';
if (python === 'python') console.warn('Aviso: no existe ml/.venv, se usa el "python" del sistema.');

const { status, error } = spawnSync(python, ['ml/train.py', ...process.argv.slice(2)], { stdio: 'inherit' });
if (error) console.error(`No se pudo ejecutar ${python}: ${error.message}`);
process.exit(status ?? 1);
