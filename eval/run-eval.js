// PARTE A — Evaluación comparativa de ambos motores.
//
// Uso:
//   node eval/run-eval.js                              # ambos motores
//   node eval/run-eval.js --engines traditional        # solo uno
//   node eval/run-eval.js --api http://127.0.0.1:3000  # pasando por el endpoint HTTP real
//
// Un caso es CORRECTO si categoría Y prioridad coinciden con la clasificación de referencia
// (eval/dataset.json, definida ANTES de ejecutar). Si el motor falla (formato inválido o
// proveedor caído) el caso cuenta como incorrecto y queda registrado el motivo.
// Salidas: results/results.json y results/results.md

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyze } from '../src/service.js';
import { validateResult } from '../src/contract.js';
import { getConfig, isConfigured } from '../src/providers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { engines: ['traditional', 'generative'], api: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--engines') args.engines = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--api') args.api = argv[++i].replace(/\/$/, '');
  }
  return args;
}

async function runOne(message, mode, apiUrl) {
  if (!apiUrl) return analyze(message, mode);
  const res = await fetch(`${apiUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, mode }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body?.error?.code ?? ''}`.trim());
  return body;
}

async function evaluate(engine, dataset, apiUrl) {
  const rows = [];
  for (const c of dataset) {
    const t0 = Date.now();
    const row = { id: c.id, type: c.type, message: c.message, expected: c.expected };
    try {
      const out = await runOne(c.message, engine, apiUrl);
      validateResult(out, engine); // verifica el contrato también sobre lo recibido
      row.category = out.category;
      row.priority = out.priority;
      row.requiresHumanReview = out.requiresHumanReview;
      row.formatOk = true;
    } catch (err) {
      row.formatOk = false;
      row.error = String(err.message).slice(0, 160);
    }
    row.categoryOk = row.category === c.expected.category;
    row.correct = row.formatOk && row.categoryOk && row.priority === c.expected.priority;
    row.ms = Date.now() - t0;
    rows.push(row);
    process.stdout.write(`  [${engine}] #${c.id} ${row.formatOk ? `${row.category}/${row.priority}` : 'ERROR'} ${row.correct ? '✔' : '✘'}\n`);
  }
  const n = rows.length;
  const pct = (k) => Math.round((rows.filter(k).length / n) * 1000) / 10;
  return {
    engine,
    rows,
    summary: {
      total: n,
      correct: rows.filter((r) => r.correct).length,
      accuracy: pct((r) => r.correct),
      categoryAccuracy: pct((r) => r.categoryOk),
      formatCompliance: pct((r) => r.formatOk),
      avgMs: Math.round(rows.reduce((s, r) => s + r.ms, 0) / n),
    },
  };
}

const esc = (s) => String(s).replace(/\|/g, '\\|');
const mark = (b) => (b ? '✔' : '✘');

function toMarkdown(results, dataset, meta) {
  const lines = [];
  lines.push('# Resultados comparativos', '');
  lines.push(`Fecha: ${meta.date} · Casos: ${dataset.length} · Vía: ${meta.via}`);
  if (meta.model) lines.push(`Modelo generativo: ${meta.model}`);
  lines.push('', 'Criterio de acierto: categoría **y** prioridad iguales a la referencia.', '');

  lines.push('## Resumen', '', '| Motor | Correctos | Precisión (cat+prio) | Precisión (solo cat) | Formato válido | Latencia media |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const s = r.summary;
    lines.push(`| ${r.engine} | ${s.correct}/${s.total} | **${s.accuracy}%** | ${s.categoryAccuracy}% | ${s.formatCompliance}% | ${s.avgMs} ms |`);
  }

  lines.push('', '## Detalle por caso', '');
  const head = ['#', 'Tipo', 'Mensaje', 'Referencia'];
  for (const r of results) head.push(`${r.engine}: obtenido`, 'formato', 'correcto');
  lines.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
  for (const c of dataset) {
    const cells = [c.id, c.type, esc(c.message), `${c.expected.category}/${c.expected.priority}`];
    for (const r of results) {
      const row = r.rows.find((x) => x.id === c.id);
      cells.push(row.formatOk ? `${row.category}/${row.priority}` : `ERROR: ${esc(row.error)}`, mark(row.formatOk), mark(row.correct));
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const { engines, api } = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(await readFile(path.join(root, 'eval', 'dataset.json'), 'utf8'));
  const config = getConfig();

  const results = [];
  for (const engine of engines) {
    if (engine === 'generative' && !api && !isConfigured(config)) {
      console.error(`Se omite "generative": proveedor "${config.provider}" sin configurar. No se simulan resultados.`);
      continue;
    }
    console.log(`\nEjecutando motor: ${engine}`);
    results.push(await evaluate(engine, dataset, api));
  }

  const meta = {
    date: new Date().toISOString(),
    via: api ? `API ${api}` : 'llamada directa al servicio',
    model: results.some((r) => r.engine === 'generative') ? `${config.provider}/${config.model}` : null,
  };
  await mkdir(path.join(root, 'results'), { recursive: true });
  await writeFile(path.join(root, 'results', 'results.json'), JSON.stringify({ meta, results }, null, 2));
  await writeFile(path.join(root, 'results', 'results.md'), toMarkdown(results, dataset, meta));

  console.log('\nResumen:');
  for (const r of results) console.log(`  ${r.engine}: ${r.summary.correct}/${r.summary.total} = ${r.summary.accuracy}%`);
  console.log('\nGuardado en results/results.json y results/results.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
