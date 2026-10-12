export const GRADUATION_DECORATION_POSITIONS = ["front", "back", "sleeve", "sash"] as const;

export type GraduationDecorationPosition = (typeof GRADUATION_DECORATION_POSITIONS)[number];
export type GraduationDecorationImage = { file: string; fileName: string };
export type GraduationDecorationImages = Partial<Record<GraduationDecorationPosition, GraduationDecorationImage>>;

type DecorationWithImages = {
  position: GraduationDecorationPosition;
  file?: string;
  fileName?: string;
  positionFiles?: GraduationDecorationImages;
};

/** Keep the old single-image fields readable while each location owns its own image. */
export function decorationPositionImages(decoration: DecorationWithImages): GraduationDecorationImages {
  const images: GraduationDecorationImages = {};
  for (const position of GRADUATION_DECORATION_POSITIONS) {
    const image = decoration.positionFiles?.[position];
    if (image?.file) images[position] = { file: image.file, fileName: image.fileName || "" };
  }
  if (decoration.file && !images[decoration.position]) {
    images[decoration.position] = { file: decoration.file, fileName: decoration.fileName || "" };
  }
  return images;
}

export function selectDecorationPosition<T extends DecorationWithImages>(decoration: T, position: GraduationDecorationPosition): T {
  const positionFiles = decorationPositionImages(decoration);
  return {
    ...decoration,
    position,
    positionFiles,
    file: positionFiles[position]?.file || "",
    fileName: positionFiles[position]?.fileName || "",
  };
}

export function setDecorationPositionImage<T extends DecorationWithImages>(
  decoration: T,
  position: GraduationDecorationPosition,
  image: GraduationDecorationImage | null,
): T {
  const positionFiles = decorationPositionImages(decoration);
  if (image?.file) positionFiles[position] = image;
  else delete positionFiles[position];
  return {
    ...decoration,
    positionFiles,
    file: positionFiles[decoration.position]?.file || "",
    fileName: positionFiles[decoration.position]?.fileName || "",
  };
}
