/** Reading a newer file never grants permission to replace text typed during that read. */
export async function loadDocumentIntoEditor<T>(options: {
  read: () => Promise<T>
  generation: () => number
  isCurrent: () => boolean
  apply: (document: T) => void
}): Promise<'applied' | 'edited' | 'superseded'> {
  const startedGeneration = options.generation()
  const document = await options.read()
  if (!options.isCurrent()) return 'superseded'
  if (options.generation() !== startedGeneration) return 'edited'
  options.apply(document)
  return 'applied'
}
