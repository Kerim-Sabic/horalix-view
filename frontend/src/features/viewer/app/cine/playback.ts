import type { FrameIndex } from '../../types';

type RefLike<T> = { current: T };

type CinePerfStats = {
  frames: number;
  slowFrames: number;
  lastLog: number;
};

type CinePlaybackParams = {
  isPlaying: boolean;
  totalSlices: number;
  cineFps: number;
  instanceUid: string | null;
  currentSliceRef: RefLike<number>;
  frameIndexRef: RefLike<FrameIndex[]>;
  imageCacheRef: RefLike<Map<string, HTMLImageElement>>;
  perfRef: RefLike<CinePerfStats>;
  getFrameUrl: (instanceUid: string, frameIndex: number) => string;
  preloadImage: (url: string) => void;
  setCurrentSlice: (slice: number) => void;
};

export const startCinePlayback = ({
  isPlaying,
  totalSlices,
  cineFps,
  instanceUid,
  currentSliceRef,
  frameIndexRef,
  imageCacheRef,
  perfRef,
  getFrameUrl,
  preloadImage,
  setCurrentSlice,
}: CinePlaybackParams): (() => void) | null => {
  if (!isPlaying || totalSlices <= 1 || !instanceUid) return null;

  let active = true;
  let lastTime = performance.now();
  const perf = perfRef.current;
  perf.frames = 0;
  perf.slowFrames = 0;
  perf.lastLog = lastTime;
  const frameDuration = 1000 / Math.max(1, cineFps);

  const tick = (now: number) => {
    if (!active) return;
    const elapsed = now - lastTime;
    if (elapsed >= frameDuration) {
      lastTime = now - (elapsed % frameDuration);
      const perf = perfRef.current;
      perf.frames += 1;
      if (elapsed > frameDuration * 1.5) {
        perf.slowFrames += 1;
      }
      if (now - perf.lastLog > 5000 && perf.frames > 0) {
        const fps = (perf.frames / (now - perf.lastLog)) * 1000;
        const slowPct = (perf.slowFrames / perf.frames) * 100;
        console.info(`viewer_cine_fps=${fps.toFixed(1)} slow_frames_pct=${slowPct.toFixed(1)}`);
        perf.frames = 0;
        perf.slowFrames = 0;
        perf.lastLog = now;
      }

      const nextSlice = (currentSliceRef.current + 1) % totalSlices;
      const frames = frameIndexRef.current;
      const nextFrame = frames[nextSlice];
      if (nextFrame) {
        const url = getFrameUrl(nextFrame.instanceUid, nextFrame.frameIndex);
        const cached = imageCacheRef.current.get(url);
        if (!cached?.complete) {
          preloadImage(url);
        }
        setCurrentSlice(nextSlice);
      }
    }
    requestAnimationFrame(tick);
  };

  const handle = requestAnimationFrame(tick);
  return () => {
    active = false;
    cancelAnimationFrame(handle);
  };
};
