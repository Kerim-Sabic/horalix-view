"""Tests for external command AI model wrapper."""

import sys
from pathlib import Path

import numpy as np
import pytest

from app.services.ai.base import ModelMetadata, ModelType
from app.services.ai.models.external_command import ExternalCommandModel


@pytest.mark.asyncio
async def test_external_model_requires_command(tmp_path: Path) -> None:
    metadata = ModelMetadata(
        name="external_test",
        version="1.0.0",
        model_type=ModelType.CLASSIFICATION,
        description="External test model",
        supported_modalities=["US"],
        license="Unknown",
    )
    weights_dir = tmp_path / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    (weights_dir / "model.pt").write_text("stub")

    model = ExternalCommandModel(
        metadata=metadata,
        command_template=None,
        weights_path=weights_dir,
        results_dir=tmp_path / "results",
    )

    with pytest.raises(RuntimeError):
        await model.load(device="cpu")


@pytest.mark.asyncio
async def test_external_model_requires_weights(tmp_path: Path) -> None:
    metadata = ModelMetadata(
        name="external_test",
        version="1.0.0",
        model_type=ModelType.CLASSIFICATION,
        description="External test model",
        supported_modalities=["US"],
        license="Unknown",
    )
    model = ExternalCommandModel(
        metadata=metadata,
        command_template=f"{sys.executable} -c \"print('ok')\"",
        weights_path=tmp_path / "missing",
        results_dir=tmp_path / "results",
    )

    with pytest.raises(FileNotFoundError):
        await model.load(device="cpu")


@pytest.mark.asyncio
async def test_external_model_runs_command(tmp_path: Path) -> None:
    metadata = ModelMetadata(
        name="external_test",
        version="1.0.0",
        model_type=ModelType.CLASSIFICATION,
        description="External test model",
        supported_modalities=["US"],
        license="Unknown",
    )
    weights_dir = tmp_path / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    (weights_dir / "model.pt").write_text("stub")

    script_path = tmp_path / "runner.py"
    script_path.write_text(
        "import json, os\n"
        "output = {'results': {'value': 1}, 'result_files': {'report': 'report.json'}}\n"
        "with open(os.environ['HORALIX_OUTPUT_JSON'], 'w', encoding='utf-8') as f:\n"
        "    json.dump(output, f)\n"
    )

    model = ExternalCommandModel(
        metadata=metadata,
        command_template=f"{sys.executable} {script_path}",
        weights_path=weights_dir,
        results_dir=tmp_path / 'results',
        timeout_seconds=10,
    )

    await model.load(device="cpu")
    result = await model.predict(np.ones((4, 4), dtype=np.float32))

    assert result.output == {"value": 1}
    assert result.metadata["result_files"]["report"] == "report.json"
