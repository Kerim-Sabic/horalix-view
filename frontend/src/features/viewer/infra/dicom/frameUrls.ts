import { api } from '@/services/api';

import type { FrameIndex } from '../../app/cine/frameIndex';

export type RenderOptions = {
  windowCenter?: number;
  windowWidth?: number;
  format: 'png' | 'jpeg';
  quality?: number;
};

export const getFrameImageUrl = (
  instanceUid: string,
  frameIndex: number,
  options: RenderOptions,
) =>
  api.instances.getPixelDataUrl(instanceUid, {
    frame: frameIndex,
    windowCenter: options.windowCenter,
    windowWidth: options.windowWidth,
    format: options.format,
    quality: options.quality,
  });

export const getFrameUrlForIndex = (frame: FrameIndex, options: RenderOptions) =>
  getFrameImageUrl(frame.instanceUid, frame.frameIndex, options);
