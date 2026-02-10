import type { FrameIndex } from '../../app/cine/frameIndex';
import { getFrameUrlForIndex, type RenderOptions } from './frameUrls';

type PrefetchWindowParams = {
  frameIndex: FrameIndex[];
  currentSlice: number;
  totalSlices: number;
  isPlaying: boolean;
  isUltrasound: boolean;
  renderOptions: RenderOptions;
  preloadImage: (url: string) => void;
};

type PrefetchWarmParams = {
  frameIndex: FrameIndex[];
  warmCount: number;
  renderOptions: RenderOptions;
  preloadImage: (url: string) => void;
};

type PrefetchFullParams = {
  frameIndex: FrameIndex[];
  maxFrames: number;
  concurrency: number;
  renderOptions: RenderOptions;
  preloadImage: (url: string) => void;
  shouldCancel: () => boolean;
  onComplete: () => void;
  idleDelayMs?: number;
};

const resolvePrefetchIndex = (
  rawIndex: number,
  totalSlices: number,
  isPlaying: boolean,
): number | null => {
  if (isPlaying) {
    return (rawIndex + totalSlices) % totalSlices;
  }
  if (rawIndex < 0 || rawIndex >= totalSlices) return null;
  return rawIndex;
};

export const prefetchAdjacentFrames = ({
  frameIndex,
  currentSlice,
  totalSlices,
  isPlaying,
  isUltrasound,
  renderOptions,
  preloadImage,
}: PrefetchWindowParams) => {
  if (totalSlices <= 1) return;
  const ahead = isPlaying ? (isUltrasound ? 12 : 8) : isUltrasound ? 6 : 4;
  const behind = isPlaying ? 4 : 1;
  for (let offset = -behind; offset <= ahead; offset += 1) {
    if (offset === 0) continue;
    const rawIndex = currentSlice + offset;
    const nextIndex = resolvePrefetchIndex(rawIndex, totalSlices, isPlaying);
    if (nextIndex === null) continue;
    const nextFrame = frameIndex[nextIndex];
    if (!nextFrame) continue;
    const url = getFrameUrlForIndex(nextFrame, renderOptions);
    preloadImage(url);
  }
};

export const prefetchWarmFrames = ({
  frameIndex,
  warmCount,
  renderOptions,
  preloadImage,
}: PrefetchWarmParams) => {
  for (let i = 0; i < warmCount; i += 1) {
    const nextFrame = frameIndex[i];
    if (!nextFrame) continue;
    const url = getFrameUrlForIndex(nextFrame, renderOptions);
    preloadImage(url);
  }
};

export const prefetchFullSeries = async ({
  frameIndex,
  maxFrames,
  concurrency,
  renderOptions,
  preloadImage,
  shouldCancel,
  onComplete,
  idleDelayMs = 200,
}: PrefetchFullParams) => {
  await new Promise((resolve) => setTimeout(resolve, idleDelayMs));

  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < maxFrames && !shouldCancel()) {
      const currentIndex = index;
      index += 1;
      const nextFrame = frameIndex[currentIndex];
      if (!nextFrame) continue;
      const url = getFrameUrlForIndex(nextFrame, renderOptions);
      preloadImage(url);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  await Promise.all(workers);
  if (!shouldCancel()) {
    onComplete();
  }
};
