function normalizeAbsolutePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const parts = path.split("/").filter(Boolean);
  return `/${parts.join("/")}`;
}

export function isPathInsideRoot(rootPath: string, filePath: string): boolean {
  const root = normalizeAbsolutePath(rootPath);
  const file = normalizeAbsolutePath(filePath);
  if (!root || !file) return false;
  return file === root || file.startsWith(`${root}/`);
}

export function getFileTreeRevealDirectories(rootPath: string, filePath: string): string[] {
  const root = normalizeAbsolutePath(rootPath);
  const file = normalizeAbsolutePath(filePath);
  if (!root || !file || !isPathInsideRoot(root, file) || file === root) return [];

  const relative = file.slice(root.length + 1);
  const parts = relative.split("/").filter(Boolean);
  if (parts.length <= 1) return [root];

  const dirs = [root];
  const current = root.split("/").filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    current.push(part);
    dirs.push(`/${current.join("/")}`);
  }
  return dirs;
}
