import { maxPhotoBytes, type ExpensePhoto } from './model'

export const photoTypes = ['image/jpeg', 'image/png', 'image/webp']

export async function preparePhoto(file: File): Promise<ExpensePhoto> {
  if (!photoTypes.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.')
  if (file.size > 16_000_000) throw new Error('Choose an image smaller than 16 MB.')
  const image = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened.') })
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the image.')
    let scale = Math.min(1400 / Math.max(image.width, image.height), 1)
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const source = canvas.toDataURL('image/jpeg', 0.79)
      if (source.startsWith('data:image/jpeg;base64,') && source.length <= 23 + 4 * Math.ceil(maxPhotoBytes / 3)) {
        return { id: crypto.randomUUID(), name: file.name.trim().slice(0, 100) || 'Expense photo', source }
      }
      scale *= 0.7
    }
    throw new Error('This photo could not be reduced to the attachment size limit.')
  } finally {
    image.close()
  }
}
