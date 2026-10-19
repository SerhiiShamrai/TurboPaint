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
 * Зберігає файли на комп'ютер користувача: один файл — як є, кілька — одним .zip.
 * У Chrome/Edge відкривається вікно "Зберегти як" (можна вибрати папку),
 * в інших браузерах файл потрапляє у "Завантаження".
 */
export async function saveFiles(files: OutputFile[], zipName: string): Promise<void> {
  if (files.length === 0) return;

  let blob: Blob;
  let name: string;
  let mime: string;
  if (files.length === 1) {
    blob = files[0].blob;
    name = files[0].name;
    mime = 'image/png';
  } else {
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
    // PNG уже стиснуті, тому zip без додаткового стиснення (level 0)
    const zipped = zipSync(entries, { level: 0 });
    blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
    name = zipName;
    mime = 'application/zip';
  }

  const picker = (window as unknown as FilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const handle = await picker.call(window, {
        suggestedName: name,
        types: [{ description: mime === 'application/zip' ? 'ZIP' : 'PNG', accept: { [mime]: [ext] } }],
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
