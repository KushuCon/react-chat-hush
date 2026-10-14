/** Shrinks a photo in the browser so it travels fast between devices. */
export async function compressImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  let max = 1100;
  let q = 0.72;
  let url = '';
  for (let n = 0; n < 4; n++) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/jpeg', q);
    if (url.length < 450_000) break;
    max *= 0.78;
    q = Math.max(0.5, q - 0.08);
  }
  bmp.close?.();
  return url;
}
