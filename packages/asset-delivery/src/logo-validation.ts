export const maxLogoBytes = 256 * 1024;
export const maxLogoDimension = 2048;

export const logoContentTypes = [
  "image/svg+xml",
  "image/png",
  "image/webp",
] as const;
export type LogoContentType = (typeof logoContentTypes)[number];

interface LogoDimensions {
  height: number;
  width: number;
}

const readPngDimensions = (content: Uint8Array): LogoDimensions => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    content.length < 33 ||
    !signature.every((byte, index) => content[index] === byte)
  ) {
    throw new Error("Logo content is not a valid PNG file.");
  }
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const isIhdr =
    content[12] === 73 &&
    content[13] === 72 &&
    content[14] === 68 &&
    content[15] === 82;
  if (view.getUint32(8) !== 13 || !isIhdr) {
    throw new Error("Logo content is not a valid PNG file.");
  }
  return { height: view.getUint32(20), width: view.getUint32(16) };
};

const readWebpDimensions = (content: Uint8Array): LogoDimensions => {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(content.subarray(start, end));
  if (content.length < 30 || text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") {
    throw new Error("Logo content is not a valid WebP file.");
  }

  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const chunk = text(12, 16);
  if (chunk === "VP8X") {
    return {
      height: 1 + view.getUint16(27, true) + (content[29] ?? 0) * 65_536,
      width: 1 + view.getUint16(24, true) + (content[26] ?? 0) * 65_536,
    };
  }
  if (chunk === "VP8L" && content[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return {
      height: (Math.floor(bits / 16_384) % 16_384) + 1,
      width: (bits % 16_384) + 1,
    };
  }
  if (
    chunk === "VP8 " &&
    content[23] === 0x9d &&
    content[24] === 0x01 &&
    content[25] === 0x2a
  ) {
    return {
      height: view.getUint16(28, true) % 16_384,
      width: view.getUint16(26, true) % 16_384,
    };
  }
  throw new Error("Logo content is not a supported WebP file.");
};

const validateSvg = (content: Uint8Array): void => {
  const svg = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  }).decode(content);
  if (!/<svg(?:\s|>)/iu.test(svg)) {
    throw new Error("Logo content is not a valid SVG file.");
  }
  if (
    /<(?:script|foreignObject|iframe|object|embed)(?:\s|>)/iu.test(svg) ||
    /\son[a-z]+\s*=/iu.test(svg) ||
    /(?:href|src)\s*=\s*["'](?!#)/iu.test(svg) ||
    /(?:@import|url\(\s*(?!["']?#))/iu.test(svg) ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/iu.test(svg)
  ) {
    throw new Error("SVG logos cannot contain scripts or external resources.");
  }
};

export function validateLogoAsset(
  content: Uint8Array,
  contentType: LogoContentType
): { height?: number; width?: number } {
  if (content.byteLength < 1 || content.byteLength > maxLogoBytes) {
    throw new Error(`Logo must be between 1 and ${maxLogoBytes} bytes.`);
  }
  if (contentType === "image/svg+xml") {
    validateSvg(content);
    return {};
  }

  const dimensions =
    contentType === "image/png"
      ? readPngDimensions(content)
      : readWebpDimensions(content);
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > maxLogoDimension ||
    dimensions.height > maxLogoDimension
  ) {
    throw new Error(
      `Raster logos cannot exceed ${maxLogoDimension} by ${maxLogoDimension} pixels.`
    );
  }
  return dimensions;
}
