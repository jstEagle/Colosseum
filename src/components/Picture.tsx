import { Box, Text } from 'ink';
import { PICTURES, type Picture as Pic } from '../art.generated.js';

export type PictureName = keyof typeof PICTURES;

/** The largest rendering of a picture that fits, or null if none does. */
export function fitPicture(name: PictureName, maxCols: number, maxRows: number): Pic | null {
  return PICTURES[name].find((p) => p.cols <= maxCols && p.rows <= maxRows) ?? null;
}

interface Props {
  name: PictureName;
  maxCols: number;
  maxRows: number;
}

/**
 * A dithered picture from art.generated.ts. Each row already carries its own
 * grey escapes, so it is handed to Ink as-is: one Text per row.
 */
export function Picture({ name, maxCols, maxRows }: Props) {
  const pic = fitPicture(name, maxCols, maxRows);
  if (!pic) return null;
  return (
    <Box flexDirection="column" width={pic.cols} flexShrink={0}>
      {pic.lines.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}
