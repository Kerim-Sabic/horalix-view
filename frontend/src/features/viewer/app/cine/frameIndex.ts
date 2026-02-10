import type { Instance } from '@/services/api';

import type { FrameIndex } from '../../types';

export type { FrameIndex } from '../../types';

export const buildFrameIndex = (instances: Instance[]): FrameIndex[] => {
  const frames: FrameIndex[] = [];
  instances.forEach((instance) => {
    const count = Math.max(1, instance.number_of_frames ?? 1);
    for (let i = 0; i < count; i += 1) {
      frames.push({
        instanceUid: instance.sop_instance_uid,
        frameIndex: i,
        rows: instance.rows ?? null,
        columns: instance.columns ?? null,
        instanceNumber: instance.instance_number ?? null,
        numberOfFrames: count,
      });
    }
  });
  return frames;
};
