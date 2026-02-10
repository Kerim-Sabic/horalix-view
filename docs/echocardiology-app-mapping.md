# Echocardiology_App Mapping -> Horalix View

Date: 2026-02-05
Reference repo: `C:\Users\kerim\OneDrive\Desktop\Echocardiology_App`

This document enumerates the exact files/classes/functions used by the reference app and maps them to the target Horalix View architecture. All paths below are from Echocardiology_App unless noted.

## 1) PanEcho (multi-task echo model)

Reference implementation
- Model load + device:
  - `backend/app/helpers/inference_functions.py`
    - `get_model_and_device()`
    - Loads PanEcho via `torch.hub.load(..., source='local')` from `backend/app/AI_models/PanEcho`
    - Sets `TORCH_HOME` to `backend/app/AI_models/PanEcho/pytorch_hub_cache`
  - Device selection: `backend/app/helpers/device_selector.py::get_device_for_model()`
- Preprocess:
  - `pick_frames_from_instance(instance_id, num_frames=16)` -> 16 frames
  - `stack_to_tensor(frames)` -> ImageNet normalization; output shape (1,3,16,224,224)
- Inference + batching:
  - `backend/app/api/inference/infer_panecho_api.py::infer_panecho()`
    - Uses `get_batch_size("panecho")` from `backend/app/helpers/batch_config.py`
    - Batched instance inference, aggregates across instances
- Aggregation:
  - Mean across instances for scalars and vector outputs; fallback first

Mapping to Horalix View
- Target runtime: `backend/app/services/ai/horalix_ai/worker.py` stages 2/3
- Model load should mirror:
  - Local PanEcho repo under `models/horalix_ai/PanEcho`
  - Torch hub local load, cached `TORCH_HOME`
- Preprocess should mirror:
  - 16 frames per instance, resize 224x224, ImageNet normalize
- Batching should mirror:
  - Use `settings.ai.horalix_ai_panecho_batch` (already present)

## 2) EchoPrime (multi-video view + metrics)

Reference implementation
- Model class: `backend/app/AI_models/EchoPrime/echo_prime/model.py`
- Loader + preload:
  - `backend/app/api/inference/infer_echoprime_api.py`
    - `get_ep()` lazy load
    - `start_echoprime_preload_background(warmup)` and `_warmup_ep()`
- Preprocess:
  - `EchoPrime.process_dicoms(study_dir)`
- Inference:
  - `EchoPrime.encode_study(stack_of_videos)`
  - `EchoPrime.predict_metrics(encoded_study)`
- View classification:
  - `EchoPrime.get_views(..., return_view_list=True, return_scores=True)`

Mapping to Horalix View
- Target runtime: `backend/app/services/ai/horalix_ai/worker.py` stages 2/3
- Implement EchoPrime adapter matching:
  - process_dicoms -> encode_study -> predict_metrics
  - get_views for per-instance view labels
- Warmup + preload should mirror EchoPrime preload flow

## 3) EchoNet-Dynamic LV segmentation

Reference implementation
- Entry API: `backend/app/api/inference/infer_echonet_dynamic_api.py`
- Model load:
  - `load_model()` builds DeeplabV3 ResNet50 with 1-channel output
  - Loads checkpoint `backend/app/AI_models/EchonetDynamic/output/segmentation/.../best.pt`
- Preprocess:
  - Frames read from DICOM via `backend/app/helpers/DICOM_to_AVI_converter.py::read_dicom_frames`
  - Resize to 112x112, convert to tensor
- Inference + batching:
  - `get_batch_size("echonet")` from `backend/app/helpers/batch_config.py`
- Postprocess:
  - Threshold + resize mask back to original size
  - Morphology and contour extraction
  - Optional ffmpeg encoding via `backend/app/helpers/AVI_to_MP4_converter.py`
- Residency:
  - `ECHONET_KEEP_LOADED` flag and CPU fallback

Mapping to Horalix View
- Target runtime: `backend/app/services/ai/horalix_ai/worker.py` stage 6
- Must mirror:
  - Model definition (deeplabv3, 1-class) and checkpoint path under `models/horalix_ai/EchonetDynamic`
  - 112x112 preprocessing
  - Batched inference using `settings.ai.horalix_ai_echonet_batch`
  - Contour extraction for overlays + EF curve

## 4) EchoNet Measurements (2D keypoint models)

Reference implementation
- Model runner: `backend/app/AI_models/measurements/runner_2d.py`
  - `_loaded_models` global cache
  - `_load_model(model_key)` loads DeeplabV3, weights from `weights/2D_models/{key}_weights.ckpt`
  - `run_2d_inference()`
    - resize to 640x480, BGR->RGB
    - batched inference using `get_batch_size("measurements")`
    - outputs coordinates, CSV, MP4
- API: `backend/app/api/inference/infer_measurements_api.py`
  - caching via DerivedResult
  - lockfile for concurrency
  - parses CSV output to compute `min_length_cm` / `max_length_cm` (used as ED/ES candidates)

Mapping to Horalix View
- Target runtime: `backend/app/services/ai/horalix_ai/worker.py` stage 5
- Must mirror:
  - same 640x480 preprocess
  - batched inference for ALL frames
  - model caching across requests
  - DICOM scale extraction (Ultrasound Region tags + PixelSpacing fallback) for cm conversion

## 5) View classification + orchestration

Reference implementation
- View classifier: `backend/app/helpers/view_classifier.py`
  - uses EchoPrime `get_views`
  - persists per-instance view to DB
- Orchestration:
  - `backend/app/background_tasks/combining_dynamic_measurements.py`
  - `backend/app/background_tasks/combining_panecho_echoprime.py`

Mapping to Horalix View
- Target runtime: `backend/app/services/ai/horalix_ai/worker.py`
- Stages should align with:
  - view classification (EchoPrime)
  - PanEcho + EchoPrime metrics
  - measurements by view
  - EchoNet only on valid apical views

## 6) Model settings and device policy

Reference implementation
- `backend/app/core/config.py`:
  - PRELOAD/WARMUP flags
  - batch sizes
  - KEEP_LOADED flags
  - per-model device selection
- `backend/app/helpers/device_selector.py`:
  - prefers GPU unless reserved

Mapping to Horalix View
- `backend/app/core/config.py` + `backend/app/services/ai/model_registry.py`
- Must support: preload, warmup, keep-loaded, batch sizes, per-model devices

## 7) EF / ED-ES logic (reference)

Reference implementation
- EF fusion (PanEcho + EchoPrime):
  - `backend/app/helpers/combine_panecho_echoprime_predictions.py::combine_panecho_echoprime_predictions`
    - Loads `backend/app/configs/thresholds.config.json`
    - For `ejection_fraction`: `combine_rule = average_value`
    - `discrepancy_threshold` applied when both models present
  - `backend/app/configs/thresholds.config.json`
    - `ejection_fraction` maps `panecho_name: EF`, `echoprime_name: ejection_fraction`
- Teichholz EF from LVID (measurement pipeline):
  - `backend/app/AI_models/measurements/utils.py`
    - `get_systole_diastole()` uses `scipy.signal.find_peaks` on smoothed diameter curve
    - `calculate_lvef_teicholz(diastolic_diameter, systolic_diameter)`
    - `process_video_with_diameter*` functions compute EF when `systole_diastole_analysis=True`

Mapping to Horalix View
- EF sources should mirror:
  - PanEcho EF + EchoPrime EF averaged with discrepancy flag
  - Teichholz EF from LVID when available (documented as method + confidence)
- ED/ES markers should align with:
  - min/max diameter (LVID) or min/max area/volume curve from cine segmentation

## Required artifacts to mirror (if not yet in Horalix View)

- PanEcho local repo: `backend/app/AI_models/PanEcho/*` (hubconf.py, weights)
- EchoPrime model package + weights: `backend/app/AI_models/EchoPrime/*`
- EchoNet-Dynamic weights: `backend/app/AI_models/EchonetDynamic/output/segmentation/.../best.pt`
- Measurements weights: `backend/app/AI_models/measurements/weights/2D_models/*.ckpt`

All of the above exist in Echocardiology_App and should be mirrored under `models/horalix_ai/` in Horalix View with equivalent relative paths.
