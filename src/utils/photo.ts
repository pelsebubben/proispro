export async function prepareDiscPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP photo.')
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This photo could not be opened. Try another JPEG, PNG or WebP file.') }
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare the photo.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.5]) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= 512 * 1024 * 4 / 3) return data
    }
    throw new Error('This photo is too detailed to upload. Choose a smaller image.')
  } finally { bitmap.close() }
}
