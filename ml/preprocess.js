// Puente para ml/train.py: recibe por stdin un arreglo JSON de mensajes y devuelve el texto
// exactamente como lo verá el modelo en producción (la misma función que usa src/ml.js).
// Así el preprocesamiento vive en un solo lugar y no hay que reescribirlo en Python.

import { text } from 'node:stream/consumers';
import { preprocess } from '../src/ml.js';

const messages = JSON.parse(await text(process.stdin));
process.stdout.write(JSON.stringify(messages.map((m) => preprocess(m).clean)));
