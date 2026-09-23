import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { scratchFile } from '../../files/files';
import { jpegInfo, type LevelSpec, type RecodedImage } from './imageBytes';

export type { CompressLevel, LevelSpec, RecodedImage } from './imageBytes';
export { IMAGE_LEVELS, PDF_LEVELS } from './imageBytes';

export async function recodeToJpeg(source: Uint8Array | string, ext: string, spec: LevelSpec): Promise<RecodedImage> {
  const scratch = typeof source === 'string' ? null : scratchFile(source, ext);
  const uri = typeof source === 'string' ? source : scratch!.uri;
  try {
    const decoded = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(decoded.width, decoded.height);
    const resized = longest > spec.maxEdge;
    const ctx = ImageManipulator.manipulate(decoded);
    if (resized) {
      if (decoded.width >= decoded.height) ctx.resize({ width: spec.maxEdge });
      else ctx.resize({ height: spec.maxEdge });
    }
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ compress: spec.quality, format: SaveFormat.JPEG });
    const out = new File(saved.uri);
    const bytes = await out.bytes();
    out.delete();
    const info = jpegInfo(bytes);
    if (info === null) throw new Error('the image codec returned something that is not a JPEG');
    return { bytes, width: info.width, height: info.height, components: info.components, resized };
  } finally {
    if (scratch?.exists) scratch.delete();
  }
}
