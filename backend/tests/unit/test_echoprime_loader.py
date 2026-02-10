import types
import sys

import pytest

from app.services.ai.horalix_ai.models.echoprime_loader import load_echoprime_models


def test_imported_echoprime_path_is_within_configured_root(tmp_path, monkeypatch):
    models_root = tmp_path / "models" / "horalix_ai" / "EchoPrime" / "model_data" / "weights"
    models_root.mkdir(parents=True, exist_ok=True)
    encoder = models_root / "echo_prime_encoder.pt"
    text_encoder = models_root / "echo_prime_text_encoder.pt"
    view_classifier = models_root / "view_classifier.pt"
    encoder.write_bytes(b"dummy")
    text_encoder.write_bytes(b"dummy")
    view_classifier.write_bytes(b"dummy")

    outside_model_file = tmp_path / "outside" / "echo_prime" / "model.py"
    outside_model_file.parent.mkdir(parents=True, exist_ok=True)
    outside_model_file.write_text("# dummy")

    echo_prime_pkg = types.ModuleType("EchoPrime")
    echo_prime_inner_pkg = types.ModuleType("EchoPrime.echo_prime")
    echo_prime_model_mod = types.ModuleType("EchoPrime.echo_prime.model")

    class DummyEchoPrime:
        def __init__(self, device=None):
            self.device = device

    echo_prime_model_mod.EchoPrime = DummyEchoPrime
    echo_prime_model_mod.__file__ = str(outside_model_file)

    monkeypatch.setitem(sys.modules, "EchoPrime", echo_prime_pkg)
    monkeypatch.setitem(sys.modules, "EchoPrime.echo_prime", echo_prime_inner_pkg)
    monkeypatch.setitem(sys.modules, "EchoPrime.echo_prime.model", echo_prime_model_mod)

    with pytest.raises(RuntimeError, match="outside configured root"):
        load_echoprime_models(
            encoder_path=encoder,
            text_encoder_path=text_encoder,
            view_classifier_path=view_classifier,
            device="cpu",
        )
