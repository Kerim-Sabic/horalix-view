import { describe, expect, it, vi } from 'vitest';

import {
  JobCancelledError,
  JobTimeoutError,
  describeJobOutcome,
  isTerminalStatus,
  waitForJob,
} from '../services/aiJobService';
import type { PollableJob } from '../services/aiJobService';

/** A fetcher that walks a scripted sequence of job states. */
function scriptedJobs(states: PollableJob[]) {
  let index = 0;
  const calls: string[] = [];
  return {
    calls,
    fetchJob: async (jobId: string) => {
      calls.push(jobId);
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      return state;
    },
  };
}

/** A clock the test advances, so no real time passes. */
function fakeClock(step = 1000) {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms || step;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const running: PollableJob = { status: 'running', progress: 0.5 };
const done: PollableJob = { status: 'completed', progress: 1 };

describe('isTerminalStatus', () => {
  it('recognises the terminal states', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('rejects in-flight states', () => {
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('queued')).toBe(false);
  });
});

describe('waitForJob', () => {
  it('returns immediately when the job is already done', async () => {
    const script = scriptedJobs([done]);
    const clock = fakeClock();

    const job = await waitForJob({
      jobId: 'j1',
      fetchJob: script.fetchJob,
      timeoutMs: 60_000,
      pollIntervalMs: 1000,
      ...clock,
    });

    expect(job.status).toBe('completed');
    expect(script.calls).toHaveLength(1);
  });

  it('polls until the job reaches a terminal state', async () => {
    const script = scriptedJobs([running, running, done]);
    const clock = fakeClock();

    const job = await waitForJob({
      jobId: 'j1',
      fetchJob: script.fetchJob,
      timeoutMs: 60_000,
      pollIntervalMs: 1000,
      ...clock,
    });

    expect(job.status).toBe('completed');
    expect(script.calls).toHaveLength(3);
  });

  it('reports progress as it arrives', async () => {
    const script = scriptedJobs([
      { status: 'running', progress: 0.25 },
      { status: 'running', progress: 0.75 },
      done,
    ]);
    const onProgress = vi.fn();

    await waitForJob({
      jobId: 'j1',
      fetchJob: script.fetchJob,
      onProgress,
      timeoutMs: 60_000,
      pollIntervalMs: 1000,
      ...fakeClock(),
    });

    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([0.25, 0.75, 1]);
  });

  it('ignores a missing or non-numeric progress', async () => {
    const script = scriptedJobs([{ status: 'running' }, { status: 'completed' }]);
    const onProgress = vi.fn();

    await waitForJob({
      jobId: 'j1',
      fetchJob: script.fetchJob,
      onProgress,
      timeoutMs: 60_000,
      pollIntervalMs: 1000,
      ...fakeClock(),
    });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('resolves with a failed job rather than throwing', async () => {
    // "The job failed" is an answer; the caller decides what to do about it.
    const script = scriptedJobs([{ status: 'failed' }]);
    const job = await waitForJob({
      jobId: 'j1',
      fetchJob: script.fetchJob,
      timeoutMs: 60_000,
      pollIntervalMs: 1000,
      ...fakeClock(),
    });
    expect(job.status).toBe('failed');
  });

  it('times out on a job that never finishes', async () => {
    const script = scriptedJobs([running]);
    const clock = fakeClock();

    await expect(
      waitForJob({
        jobId: 'stuck',
        fetchJob: script.fetchJob,
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        ...clock,
      })
    ).rejects.toBeInstanceOf(JobTimeoutError);
  });

  it('names the job in the timeout message', async () => {
    const script = scriptedJobs([running]);
    await expect(
      waitForJob({
        jobId: 'stuck',
        fetchJob: script.fetchJob,
        timeoutMs: 2_000,
        pollIntervalMs: 1_000,
        ...fakeClock(),
      })
    ).rejects.toThrow(/stuck/);
  });

  it('does not spend an extra poll interval past the deadline', async () => {
    const script = scriptedJobs([running]);
    const clock = fakeClock();

    await expect(
      waitForJob({
        jobId: 'stuck',
        fetchJob: script.fetchJob,
        timeoutMs: 3_000,
        pollIntervalMs: 1_000,
        ...clock,
      })
    ).rejects.toBeInstanceOf(JobTimeoutError);

    // Deadline checked before sleeping: 4 polls at t=0,1,2,3 then bail.
    expect(script.calls.length).toBeLessThanOrEqual(4);
  });

  it('stops when the signal is already aborted', async () => {
    const script = scriptedJobs([running]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForJob({
        jobId: 'j1',
        fetchJob: script.fetchJob,
        timeoutMs: 60_000,
        pollIntervalMs: 1000,
        signal: controller.signal,
        ...fakeClock(),
      })
    ).rejects.toBeInstanceOf(JobCancelledError);

    expect(script.calls).toHaveLength(0);
  });

  it('stops when the signal aborts mid-flight', async () => {
    // The loop this replaces could not be cancelled: navigating away from a
    // study left it polling until the job finished or the timeout elapsed.
    const controller = new AbortController();
    const script = scriptedJobs([running, running, done]);

    await expect(
      waitForJob({
        jobId: 'j1',
        fetchJob: script.fetchJob,
        timeoutMs: 60_000,
        pollIntervalMs: 1000,
        signal: controller.signal,
        now: () => 0,
        sleep: async () => {
          controller.abort();
          throw new DOMException('Aborted', 'AbortError');
        },
      })
    ).rejects.toBeInstanceOf(JobCancelledError);
  });

  it('propagates a fetch failure', async () => {
    await expect(
      waitForJob({
        jobId: 'j1',
        fetchJob: async () => {
          throw new Error('network down');
        },
        timeoutMs: 60_000,
        pollIntervalMs: 1000,
        ...fakeClock(),
      })
    ).rejects.toThrow('network down');
  });
});

describe('describeJobOutcome', () => {
  it('says nothing about a completed job', () => {
    expect(describeJobOutcome({ status: 'completed' }, 'Horalix AI')).toBeNull();
  });

  it('names the model in a failure', () => {
    expect(describeJobOutcome({ status: 'failed' }, 'Horalix AI')).toContain('Horalix AI');
  });

  it('distinguishes cancellation from failure', () => {
    expect(describeJobOutcome({ status: 'cancelled' }, 'EchoNet')).toContain('cancelled');
    expect(describeJobOutcome({ status: 'failed' }, 'EchoNet')).toContain('failed');
  });

  it('reports an unexpected state rather than staying silent', () => {
    const message = describeJobOutcome({ status: 'weird' }, 'EchoNet');
    expect(message).toContain('weird');
  });
});
