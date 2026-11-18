import { maxPhotoBytes, maxProfilePhotoBytes, type ExpensePhoto, type MemberAvatar } from './model'

export const photoTypes = ['image/jpeg', 'image/png', 'image/webp']

async function encodeImage(file: File, maxDimension: number, maxBytes: number) {
  if (!photoTypes.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.')
  if (file.size > 16_000_000) throw new Error('Choose an image smaller than 16 MB.')
  const image = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened.') })
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the image.')
    let scale = Math.min(maxDimension / Math.max(image.width, image.height), 1)
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const source = canvas.toDataURL('image/jpeg', 0.79)
      if (source.startsWith('data:image/jpeg;base64,') && source.length <= 23 + 4 * Math.ceil(maxBytes / 3)) {
        return source
      }
      scale *= 0.7
    }
    throw new Error('This photo could not be reduced to the attachment size limit.')
  } finally {
    image.close()
  }
}

export async function preparePhoto(file: File): Promise<ExpensePhoto> {
  return { id: crypto.randomUUID(), name: file.name.trim().slice(0, 100) || 'Expense photo',
    source: await encodeImage(file, 1400, maxPhotoBytes) }
}

export async function prepareProfilePhoto(file: File): Promise<MemberAvatar> {
  return { kind: 'photo', source: await encodeImage(file, 320, maxProfilePhotoBytes) }
}
