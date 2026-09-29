/** Share image files through the platform picker, or download them in a browser. */
export async function shareFiles(files: File[], title: string, dialogTitle: string): Promise<'shared' | 'downloaded'> {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    const [{ Share }, { Directory, Filesystem }] = await Promise.all([import('@capacitor/share'), import('@capacitor/filesystem')])
    const paths: string[] = []
    for (const [index, file] of files.entries()) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error ?? new Error('无法读取图片文件'))
        reader.readAsDataURL(file)
      })
      const safeName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      const path = `image-share/${Date.now()}-${index}-${safeName}`
      await Filesystem.writeFile({ path, directory: Directory.Cache, data, recursive: true })
      paths.push((await Filesystem.getUri({ path, directory: Directory.Cache })).uri)
    }
    await Share.share({ title, files: paths, dialogTitle })
    return 'shared'
  }
  if (navigator.canShare?.({ files }) && navigator.share) {
    await navigator.share({ title, files })
    return 'shared'
  }
  for (const file of files) {
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return 'downloaded'
}
