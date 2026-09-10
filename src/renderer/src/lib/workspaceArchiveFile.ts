export const WORKSPACE_ARCHIVE_ACCEPT = '.storyfabric.zip,application/zip'

export function isWorkspaceArchiveFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.storyfabric.zip')
}

export async function readWorkspaceArchiveFile(file: File): Promise<Uint8Array> {
  if (!isWorkspaceArchiveFile(file)) throw new Error('请选择 .storyfabric.zip 工作区压缩包')
  return new Uint8Array(await file.arrayBuffer())
}
