import { zipSync } from 'fflate';

export interface OutputFile {
  name: string;
  blob: Blob;
}

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Зберігає один файл на комп'ютер користувача.
 * У Chrome/Edge відкривається вікно "Зберегти як" (можна вибрати папку),
 * в інших браузерах файл потрапляє у "Завантаження".
 */
export async function saveBlob(blob: Blob, name: string, description: string, mime: string): Promise<void> {
  const picker = (window as unknown as FilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const handle = await picker.call(window, {
        suggestedName: name,
        types: [{ description, accept: { [mime]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      // Користувач закрив вікно — нічого не робимо; інші помилки — запасний варіант
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, name);
}

/** Зберігає файли: один — як є, кілька — одним .zip. */
export async function saveFiles(files: OutputFile[], zipName: string): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    await saveBlob(files[0].blob, files[0].name, 'PNG', 'image/png');
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  // PNG уже стиснуті, тому zip без додаткового стиснення (level 0)
  const zipped = zipSync(entries, { level: 0 });
  await saveBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), zipName, 'ZIP', 'application/zip');
}
