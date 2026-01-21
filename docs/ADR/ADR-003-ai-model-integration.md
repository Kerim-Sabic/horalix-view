# ADR-003: AI Model Integration Approach

## Status

Accepted

## Date

2024-01-15

## Context

Horalix View needs to provide AI-powered analysis of medical images, including:
- Automatic segmentation of anatomical structures
- Detection of abnormalities
- Measurement assistance
- Classification of findings

We needed to decide:
1. How to integrate AI models into the application
2. How to manage multiple model types
3. How to handle inference performance
4. How to support future model additions

## Decision

We implemented a **Registry-Based Plugin Architecture** for AI models.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Model Integration                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Model Registry                          │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  register_model(name, model_class)                  │ │   │
│  │  │  get_model(name) -> AIModel                         │ │   │
│  │  │  list_models() -> List[ModelInfo]                   │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │   YOLOv8     │ │    MONAI     │ │   MedSAM     │            │
│  │  Detector    │ │  Segmenter   │ │  Segmenter   │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Base AIModel Interface                       │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  load() -> None                                     │ │   │
│  │  │  predict(image: np.ndarray) -> Dict                 │ │   │
│  │  │  preprocess(dicom: Dataset) -> np.ndarray           │ │   │
│  │  │  postprocess(output) -> Dict                        │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Base Model Interface

```python
class AIModel(ABC):
    """Abstract base class for all AI models."""

    @abstractmethod
    def load(self) -> None:
        """Load model weights."""
        pass

    @abstractmethod
    def predict(self, image: np.ndarray) -> Dict[str, Any]:
        """Run inference on preprocessed image."""
        pass

    def preprocess(self, dicom_dataset: Dataset) -> np.ndarray:
        """Convert DICOM to model input format."""
        # Default implementation, can be overridden
        pass

    def postprocess(self, model_output: Any) -> Dict[str, Any]:
        """Convert model output to standard format."""
        pass
```

### Model Types Supported

| Model | Type | Use Case | Output Format |
|-------|------|----------|---------------|
| YOLOv8 | Detection | Find abnormalities | Bounding boxes + confidence |
| MONAI | Segmentation | Organ segmentation | Binary/multi-class masks |
| MedSAM | Segmentation | Interactive segmentation | Binary masks |

### Lazy Loading Strategy

Models are loaded on-demand to conserve memory:

```python
class ModelRegistry:
    def __init__(self):
        self._models: Dict[str, Type[AIModel]] = {}
        self._instances: Dict[str, AIModel] = {}

    def get_model(self, name: str) -> AIModel:
        if name not in self._instances:
            model_class = self._models[name]
            instance = model_class()
            instance.load()  # Load weights on first use
            self._instances[name] = instance
        return self._instances[name]
```

### Inference Modes

1. **Synchronous** (simple cases):
   - Small images, fast models
   - Direct API response

2. **Asynchronous** (complex cases):
   - Large volumes, slow models
   - Job queue with status polling

```python
# Synchronous endpoint
@router.post("/analyze")
async def analyze_sync(study_uid: str, model: str):
    result = await run_in_executor(
        model_registry.get_model(model).predict,
        image_data
    )
    return result

# Asynchronous endpoint
@router.post("/analyze/async")
async def analyze_async(study_uid: str, model: str):
    job_id = await create_job(study_uid, model)
    background_tasks.add_task(run_inference, job_id)
    return {"job_id": job_id, "status": "pending"}
```

### Model Weight Management

```
models/
├── weights/
│   ├── yolov8_medical.pt      # Detection weights
│   ├── monai_segmenter.pth    # Segmentation weights
│   └── medsam_vit_h.pth       # MedSAM weights
└── configs/
    ├── yolov8_config.yaml
    └── monai_config.yaml
```

- Weights not committed to git (large files)
- Downloaded on first run or via setup script
- Configurable paths via environment variables

## Consequences

### Positive

- **Extensibility**: New models added by implementing interface
- **Isolation**: Model failures don't crash application
- **Memory efficiency**: Lazy loading conserves resources
- **Testability**: Models can be mocked for testing
- **Flexibility**: Sync/async modes for different use cases

### Negative

- **Cold start**: First inference slower (model loading)
- **Memory pressure**: Multiple loaded models consume RAM
- **Complexity**: Abstraction adds code overhead

### Mitigations

1. **Cold start**: Optional model preloading on startup
2. **Memory**: LRU cache for model instances, configurable limits
3. **Complexity**: Well-documented interfaces, example implementations

## Future Considerations

1. **Model Versioning**: Support multiple versions of same model
2. **GPU Scheduling**: Manage GPU memory across models
3. **External Services**: Option to call external AI APIs
4. **Model Ensemble**: Combine multiple model outputs
5. **Continuous Learning**: Infrastructure for model updates

## Adding a New Model

1. Create model class implementing `AIModel`:

```python
# app/services/ai/models/my_model.py
class MyModel(AIModel):
    def load(self):
        self.model = load_weights("path/to/weights")

    def predict(self, image: np.ndarray) -> Dict:
        output = self.model(image)
        return self.postprocess(output)
```

2. Register in model registry:

```python
# app/services/ai/__init__.py
from .models.my_model import MyModel
model_registry.register("my_model", MyModel)
```

3. Model is now available via API:

```bash
POST /api/v1/ai/analyze
{
  "study_uid": "1.2.3.4",
  "model": "my_model"
}
```

## Related Decisions

- ADR-001: System Architecture
- ADR-002: Technology Stack Choices
