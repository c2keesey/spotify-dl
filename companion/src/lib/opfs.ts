async function setDir(stem: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const sets = await root.getDirectoryHandle("sets", { create });
  return sets.getDirectoryHandle(stem, { create });
}

export async function audioDir(stem: string): Promise<FileSystemDirectoryHandle> {
  const dir = await setDir(stem, true);
  return dir.getDirectoryHandle("audio", { create: true });
}

export async function writeAudio(stem: string, name: string, data: Uint8Array): Promise<void> {
  const dir = await audioDir(stem);
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(data as unknown as BufferSource);
  await writable.close();
}

export async function readAudioBlob(stem: string, name: string): Promise<Blob> {
  const dir = await audioDir(stem);
  const file = await dir.getFileHandle(name);
  return file.getFile();
}

export async function deleteAudioFile(stem: string, name: string): Promise<void> {
  const dir = await audioDir(stem);
  await dir.removeEntry(name);
}

export async function deleteSetAudio(stem: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const sets = await root.getDirectoryHandle("sets", { create: true });
  await sets.removeEntry(stem, { recursive: true });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
