import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Layer } from './layers';

/** Знімок моделі та фарби зі сцени (без налаштувань інтерфейсу) */
export interface ProjectSnapshot {
  model: { kind: 'cube' } | { kind: 'file'; name: string; buffer: ArrayBuffer };
  /** По одному запису на матеріал у порядку обходу моделі */
  materials: Array<{ name: string; base: Uint8Array; layers: Record<string, Uint8Array> }>;
}

/** Налаштування, які зберігаються разом зі знімком */
export interface ProjectSettings {
  cubeColor: number;
  cubeSize: number;
  layers: Layer[];
  activeLayerId: string | null;
  brush: { color: string; size: number; space: 'screen' | 'model'; tool: 'brush' | 'eraser' };
}

const FORMAT = 'turbopainter-project';
const VERSION = 1;
export const PROJECT_EXTENSION = '.tpaint';

/**
 * Файл проєкту — це zip:
 *   project.json            — налаштування, шари, опис моделі
 *   model.glb               — завантажена модель (якщо це не стартовий куб)
 *   base/<n>.raw            — початковий вигляд матеріалу n (RGBA, без втрат)
 *   layers/<id>/<n>.raw     — фарба шару <id> на матеріалі n (RGBA, без втрат)
 * Нові типи даних (маски, канали PBR) додаватимуться як нові файли з підвищенням version.
 */
export function packProject(snapshot: ProjectSnapshot, settings: ProjectSettings): Blob {
  const files: Record<string, Uint8Array> = {};

  const meta = {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    model:
      snapshot.model.kind === 'file'
        ? { kind: 'file', file: 'model.glb', name: snapshot.model.name }
        : { kind: 'cube' },
    cube: { color: settings.cubeColor, size: settings.cubeSize },
    layers: settings.layers,
    activeLayerId: settings.activeLayerId,
    brush: settings.brush,
    materials: snapshot.materials.map((m) => ({ name: m.name, layerIds: Object.keys(m.layers) })),
  };
  files['project.json'] = strToU8(JSON.stringify(meta, null, 2));

  if (snapshot.model.kind === 'file') {
    files['model.glb'] = new Uint8Array(snapshot.model.buffer);
  }
  snapshot.materials.forEach((m, i) => {
    files[`base/${i}.raw`] = m.base;
    for (const [id, bytes] of Object.entries(m.layers)) files[`layers/${id}/${i}.raw`] = bytes;
  });

  // Текстури здебільшого однотонні, тому звичайне стиснення дуже зменшує файл
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/octet-stream' });
}

export function unpackProject(buffer: ArrayBuffer): { snapshot: ProjectSnapshot; settings: ProjectSettings } {
  const files = unzipSync(new Uint8Array(buffer));
  const metaBytes = files['project.json'];
  if (!metaBytes) throw new Error('Це не файл проєкту TurboPainter (немає project.json)');

  const meta = JSON.parse(strFromU8(metaBytes));
  if (meta.format !== FORMAT) throw new Error('Це не файл проєкту TurboPainter');
  if (typeof meta.version !== 'number' || meta.version > VERSION) {
    throw new Error('Проєкт створено новішою версією програми. Оновіть сторінку (Ctrl+F5) і спробуйте ще раз.');
  }

  let model: ProjectSnapshot['model'] = { kind: 'cube' };
  if (meta.model?.kind === 'file') {
    const bytes = files[meta.model.file];
    if (!bytes) throw new Error('У файлі проєкту немає моделі');
    model = { kind: 'file', name: String(meta.model.name || 'model.glb'), buffer: bytes.slice().buffer as ArrayBuffer };
  }

  const materials: ProjectSnapshot['materials'] = (meta.materials as Array<{ name: string; layerIds: string[] }>).map(
    (m, i) => {
      const layers: Record<string, Uint8Array> = {};
      for (const id of m.layerIds) {
        const bytes = files[`layers/${id}/${i}.raw`];
        if (bytes) layers[id] = bytes;
      }
      return { name: m.name, base: files[`base/${i}.raw`] ?? new Uint8Array(0), layers };
    }
  );

  return {
    snapshot: { model, materials },
    settings: {
      cubeColor: meta.cube?.color ?? 0x888888,
      cubeSize: meta.cube?.size ?? 1,
      layers: meta.layers ?? [],
      activeLayerId: meta.activeLayerId ?? null,
      brush: meta.brush ?? { color: '#ff0000', size: 24, space: 'screen', tool: 'brush' },
    },
  };
}
