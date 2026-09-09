/** 远程探测输出的解析。 */
export function parseOs(unameS: string): 'linux' | 'unsupported' {
  return unameS.trim().toLowerCase() === 'linux' ? 'linux' : 'unsupported'
}

export function parseDockerVersion(output: string): string | undefined {
  const text = output.trim()
  return /^\d+\.\d+\.\d+/.test(text) ? text.split('\n')[0].trim() : undefined
}

export function parsePortInUse(ssOutput: string): boolean {
  return /LISTEN/i.test(ssOutput)
}

export function parsePasswordlessSudo(exitCode: number): boolean {
  return exitCode === 0
}

export function parseOsRelease(text: string): { id?: string; prettyName?: string } {
  const id = /^ID=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '')
  const prettyName = /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '')
  return { id, prettyName }
}

export function parseContainerImage(inspectOutput: string): string | undefined {
  const text = inspectOutput.trim()
  if (!text || /^error/i.test(text)) return undefined
  return text.split('\n')[0].trim()
}
