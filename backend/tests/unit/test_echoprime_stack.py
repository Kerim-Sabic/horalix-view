from pathlib import Path

import torch

from app.services.ai.horalix_ai.worker import HoralixAIWorker


class DummyEchoPrimeAligned:
    def process_dicoms(self, cine_paths, return_meta: bool = False):
        paths = [str(p) for p in cine_paths]
        stack = torch.zeros((len(paths), 3, 16, 224, 224))
        uids = [Path(p).stem for p in paths]
        meta = [
            {
                "dicom_path": path,
                "sop_instance_uid": uid,
                "series_instance_uid": "SERIES_1",
                "instance_number": idx + 1,
            }
            for idx, (path, uid) in enumerate(zip(paths, uids))
        ]
        if return_meta:
            return stack, paths, uids, meta
        return stack


class DummyEchoPrimeMisaligned:
    def process_dicoms(self, cine_paths, return_meta: bool = False):
        paths = [str(p) for p in cine_paths]
        stack = torch.zeros((len(paths), 3, 16, 224, 224))
        uids = [Path(p).stem for p in paths][::-1]
        meta = [
            {
                "dicom_path": path,
                "sop_instance_uid": uid,
                "series_instance_uid": "SERIES_1",
                "instance_number": idx + 1,
            }
            for idx, (path, uid) in enumerate(zip(paths, uids))
        ]
        if return_meta:
            return stack, paths, uids, meta
        return stack


class DummyEchoPrimeNoMeta:
    def process_dicoms(self, cine_paths, return_meta: bool = False):
        if return_meta:
            raise TypeError("return_meta is not supported")
        paths = [str(p) for p in cine_paths]
        return torch.zeros((len(paths), 3, 16, 224, 224))


class DummyEchoPrimeGetViewsFailure:
    def get_views(self, stack, visualize=False, return_view_list=True, return_scores=True):
        raise RuntimeError("simulated get_views failure")


def _mock_collect():
    return [
        {
            "dicom_path": "/tmp/study/uid_a.dcm",
            "sop_instance_uid": "uid_a",
            "series_instance_uid": "SERIES_1",
            "instance_number": 1,
            "acquisition_time": "101010",
            "content_time": "101010",
        },
        {
            "dicom_path": "/tmp/study/uid_b.dcm",
            "sop_instance_uid": "uid_b",
            "series_instance_uid": "SERIES_1",
            "instance_number": 2,
            "acquisition_time": "101011",
            "content_time": "101011",
        },
    ]


def test_load_echoprime_stack_deterministic_mapping(monkeypatch):
    worker = HoralixAIWorker(gpu_id=0)
    worker.echoprime_model = DummyEchoPrimeAligned()
    monkeypatch.setattr(worker, "_resolve_study_path", lambda study_uid: Path("/tmp/study"))
    monkeypatch.setattr(worker, "_collect_echoprime_cines", lambda study_path: _mock_collect())

    stack, uids = worker._load_echoprime_stack("study1")

    assert stack is not None
    assert stack.shape[0] == 2
    assert uids == ["uid_a", "uid_b"]
    assert worker._echoprime_view_mapping_ok is True
    assert worker._echoprime_view_mapping_reason is None


def test_load_echoprime_stack_detects_uid_order_mismatch(monkeypatch):
    worker = HoralixAIWorker(gpu_id=0)
    worker.echoprime_model = DummyEchoPrimeMisaligned()
    monkeypatch.setattr(worker, "_resolve_study_path", lambda study_uid: Path("/tmp/study"))
    monkeypatch.setattr(worker, "_collect_echoprime_cines", lambda study_path: _mock_collect())

    stack, uids = worker._load_echoprime_stack("study1")

    assert stack is not None
    assert uids == ["uid_a", "uid_b"]
    assert worker._echoprime_view_mapping_ok is False
    assert worker._echoprime_view_mapping_reason in {"meta_uid_order_mismatch", "uid_order_mismatch"}


def test_load_echoprime_stack_return_meta_unsupported(monkeypatch):
    worker = HoralixAIWorker(gpu_id=0)
    worker.echoprime_model = DummyEchoPrimeNoMeta()
    monkeypatch.setattr(worker, "_resolve_study_path", lambda study_uid: Path("/tmp/study"))
    monkeypatch.setattr(worker, "_collect_echoprime_cines", lambda study_path: _mock_collect())

    stack, uids = worker._load_echoprime_stack("study1")

    assert stack is None
    assert uids == []
    assert worker._echoprime_view_mapping_ok is False
    assert worker._echoprime_view_mapping_reason == "return_meta_unsupported"


def test_view_prediction_unknown_on_get_views_failure():
    worker = HoralixAIWorker(gpu_id=0)
    worker.echoprime_model = DummyEchoPrimeGetViewsFailure()
    stack = torch.zeros((2, 3, 16, 224, 224))

    views, confidences = worker._predict_views_from_stack(stack)

    assert views == ["Unknown", "Unknown"]
    assert confidences == [0.0, 0.0]
