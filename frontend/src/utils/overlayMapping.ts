export type DetectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const scaleDetectionBox = (
  box: DetectionBox,
  inputShape: [number, number],
  outputShape: [number, number]
): DetectionBox => {
  const [inputRows, inputCols] = inputShape;
  const [outputRows, outputCols] = outputShape;
  if (!inputRows || !inputCols) {
    return { ...box };
  }
  const scaleX = outputCols / inputCols;
  const scaleY = outputRows / inputRows;
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
};

export const clampMaskSliceIndex = (sliceIndex: number, maskShape: number[] | null): number => {
  if (!maskShape || maskShape.length < 3) return 0;
  const maxSlice = Math.max(0, maskShape[0] - 1);
  return Math.min(Math.max(sliceIndex, 0), maxSlice);
};
