import argparse
import os
import sys
import time
from typing import Optional

import requests


def _headers() -> dict:
    token = os.environ.get("HORALIX_TOKEN") or os.environ.get("HORALIX_API_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}


def _poll_job(base_url: str, job_id: str, poll_interval: float) -> dict:
    url = f"{base_url.rstrip('/')}/api/v1/ai/jobs/{job_id}"
    start = time.time()
    last_progress = -1
    while True:
        resp = requests.get(url, headers=_headers(), timeout=30)
        resp.raise_for_status()
        job = resp.json()
        progress = job.get("progress")
        if isinstance(progress, (int, float)) and progress != last_progress:
            print(f"progress={progress}")
            last_progress = progress

        status = job.get("status")
        if status in ("completed", "failed", "cancelled"):
            job["_elapsed_s"] = time.time() - start
            return job

        time.sleep(poll_interval)


def run_once(
    base_url: str,
    study_uid: str,
    model_name: str,
    enable_measurements: bool,
    enable_echonet: bool,
    poll_interval: float,
) -> dict:
    create_url = f"{base_url.rstrip('/')}/api/v1/ai/jobs"
    payload = {
        "model_type": model_name,
        "task_type": "cardiac",
        "study_uid": study_uid,
        "series_uid": None,
        "parameters": {
            "enable_measurements": enable_measurements,
            "enable_echonet": enable_echonet,
        },
    }

    resp = requests.post(create_url, json=payload, headers=_headers(), timeout=60)
    resp.raise_for_status()
    job = resp.json()
    job_id = job.get("job_id")
    if not job_id:
        raise RuntimeError("Failed to create job: missing job_id")

    print(f"job_id={job_id}")
    return _poll_job(base_url, job_id, poll_interval)


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark Horalix AI end-to-end runtime.")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--study-uid", required=True, help="Study UID to run")
    parser.add_argument("--model", default="horalix_ai", help="Model name (default: horalix_ai)")
    parser.add_argument("--enable-measurements", action="store_true", default=True)
    parser.add_argument("--disable-measurements", dest="enable_measurements", action="store_false")
    parser.add_argument("--enable-echonet", action="store_true", default=True)
    parser.add_argument("--disable-echonet", dest="enable_echonet", action="store_false")
    parser.add_argument("--poll-interval", type=float, default=1.0)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--max-seconds", type=float, default=None)
    args = parser.parse_args()

    results = []
    for idx in range(args.repeat):
        print(f"run={idx+1}/{args.repeat}")
        job = run_once(
            args.base_url,
            args.study_uid,
            args.model,
            args.enable_measurements,
            args.enable_echonet,
            args.poll_interval,
        )
        results.append(job)

    # Summarize
    for i, job in enumerate(results):
        status = job.get("status")
        elapsed_s = job.get("_elapsed_s")
        inference_ms = job.get("inference_time_ms")
        print(
            f"summary[{i}]: status={status} elapsed_s={elapsed_s:.1f} "
            f"inference_ms={inference_ms}"
        )

    # Enforce threshold if provided
    if args.max_seconds is not None:
        for job in results:
            elapsed_s = job.get("_elapsed_s") or 0
            if elapsed_s > args.max_seconds:
                print(f"FAILED: elapsed_s {elapsed_s:.1f} > max_seconds {args.max_seconds}")
                return 1

    # Fail if any run failed
    for job in results:
        if job.get("status") != "completed":
            print(f"FAILED: job status {job.get('status')}")
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
