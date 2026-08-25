/**
 * AI job polling
 *
 * Waiting on a long-running inference job: poll until it reaches a terminal
 * state, surface progress as it arrives, and give up after a bounded time
 * rather than polling forever.
 *
 * Extracted from the viewer so the timeout, the terminal-state set and the
 * cancellation path are testable without mounting a component. The loop this
 * replaces could not be cancelled at all — navigating away from a study left it
 * polling until the job finished or the timeout elapsed.
 */

/** Job states from which no further transition happens. */
export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export interface PollableJob {
  status: string;
  progress?: number | null;
}

export const isTerminalStatus = (status: string): status is TerminalJobStatus =>
  (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);

export class JobTimeoutError extends Error {
  constructor(
    readonly jobId: string,
    readonly timeoutMs: number
  ) {
    super(`Job ${jobId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'JobTimeoutError';
  }
}

export class JobCancelledError extends Error {
  constructor(readonly jobId: string) {
    super(`Stopped waiting for job ${jobId}`);
    this.name = 'JobCancelledError';
  }
}

export interface WaitForJobOptions<TJob extends PollableJob> {
  jobId: string;
  /** Fetch the job's current state. */
  fetchJob: (jobId: string) => Promise<TJob>;
  /** Called whenever the job reports a progress value. */
  onProgress?: (progress: number) => void;
  timeoutMs: number;
  pollIntervalMs: number;
  /** Aborts the wait; the promise rejects with JobCancelledError. */
  signal?: AbortSignal;
  /** Injected in tests so the poll interval need not elapse in real time. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Poll a job until it reaches a terminal state.
 *
 * Resolves with the terminal job — including a failed one, since "the job
 * failed" is an answer and the caller decides what to do about it. Rejects only
 * when the wait itself could not complete: a timeout, a cancellation, or a
 * fetch that threw.
 */
export async function waitForJob<TJob extends PollableJob>({
  jobId,
  fetchJob,
  onProgress,
  timeoutMs,
  pollIntervalMs,
  signal,
  sleep = defaultSleep,
  now = Date.now,
}: WaitForJobOptions<TJob>): Promise<TJob> {
  const startedAt = now();

  for (;;) {
    if (signal?.aborted) throw new JobCancelledError(jobId);

    const job = await fetchJob(jobId);

    if (typeof job.progress === 'number' && Number.isFinite(job.progress)) {
      onProgress?.(job.progress);
    }

    if (isTerminalStatus(job.status)) {
      return job;
    }

    // Check the deadline before sleeping, so a job that will never finish does
    // not cost one extra poll interval on the way out.
    if (now() - startedAt >= timeoutMs) {
      throw new JobTimeoutError(jobId, timeoutMs);
    }

    try {
      await sleep(pollIntervalMs, signal);
    } catch {
      throw new JobCancelledError(jobId);
    }
  }
}

/**
 * Human-readable reason a job did not produce results.
 *
 * Job failures reach the operator as a notification, so the message has to say
 * what happened rather than surfacing a status enum.
 */
export function describeJobOutcome(job: PollableJob, modelLabel: string): string | null {
  switch (job.status) {
    case 'completed':
      return null;
    case 'failed':
      return `${modelLabel} failed to complete. Check the job log for details.`;
    case 'cancelled':
      return `${modelLabel} was cancelled.`;
    default:
      return `${modelLabel} finished in an unexpected state (${job.status}).`;
  }
}
