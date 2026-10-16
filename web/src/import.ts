// Turn a drop into a flat list of files, walking dropped folders recursively.

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns at most ~100 entries per call; keep reading until it returns none.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, out: File[]) {
  if (entry.isFile) {
    if (entry.name.startsWith(".")) return; // .DS_Store & co.
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push(file);
  } else if (entry.isDirectory) {
    const entries = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const e of entries) await walk(e, out);
  }
}

export async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  // Entries must be grabbed synchronously, before the drop event finishes.
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  const plain = Array.from(dt.files ?? []);
  if (!entries.length || !entries.some((e) => e.isDirectory)) return plain;
  const out: File[] = [];
  for (const e of entries) {
    try {
      await walk(e, out);
    } catch {
      // unreadable entry: skip
    }
  }
  return out;
}
