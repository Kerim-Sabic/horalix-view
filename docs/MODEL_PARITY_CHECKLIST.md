# Model Parity Checklist (Horalix View)

This checklist maps primary-source model expectations to the current Horalix implementation. Use it when validating preprocessing, view gating, overlays, and AI report outputs.

## PanEcho
- Primary source: [PanEcho README](https://github.com/CarDS-Yale/PanEcho) (input tensor `(batch, 3, 16, 224, 224)`; 16-frame 224x224 clip, ImageNet normalized).
- Expected inputs:
  - 16 frames
  - 224x224 resolution
  - 3 channels
- Horalix implementation:
  - `backend/app/services/ai/horalix_ai/preprocessing/panecho_prep.py`
  - `sample_frames_for_panecho()` enforces 16 frames
  - `preprocess_for_panecho()` resizes to 224x224
- Parity status: OK (matches expected input contract).

## EchoPrime
- Primary source: [EchoPrime README](https://github.com/echonet/EchoPrime) (encode_study expects `(num_videos, 3, 16, 224, 224)`).
- Expected inputs:
  - Multi-video batch, each video 3x16x224x224
  - EchoPrime also provides `process_dicoms()` to build the study stack from DICOMs
- Horalix implementation:
  - `backend/app/services/ai/horalix_ai/worker.py::_load_echoprime_stack()` uses `process_dicoms()` directly
  - View classification uses the EchoPrime view classifier on the same stack
- Parity status: OK (direct DICOM preprocessing parity).

## EchoNet-Dynamic
- Primary source: [EchoNet-Dynamic dataset](https://echonet.github.io/dynamic/) (apical-4-chamber videos downsampled to 112x112).
- Expected inputs:
  - A4C view
  - 112x112 spatial resolution
- Horalix implementation:
  - `backend/app/services/ai/horalix_ai/preprocessing/echonet_prep.py` resizes to 112x112
  - `stage_6_echonet()` gates overlays to A4C + minimum view confidence
- Parity status: OK (view-gated + 112x112 preprocessing).

## EchoNet-Measurements
- Primary source: [EchoNet-Measurements README](https://github.com/echonet/measurements) (2D video at 480x640; Doppler at 426x1080).
- Expected inputs:
  - 2D video: 480x640
  - Doppler: 426x1080 (cropped ROI)
- Horalix implementation:
  - 2D path: `backend/app/services/ai/horalix_ai/preprocessing/measurements_prep.py` (480x640)
  - Doppler path: **not yet wired** (no doppler preprocessor or model runner in the current pipeline)
- Parity status: PARTIAL (2D parity OK; Doppler not yet integrated).

## MedSAM (Smart Segmentation)
- Primary source: [MedSAM paper](https://arxiv.org/abs/2304.12306) (foundation model for universal medical image segmentation).
- Expected inputs:
  - Promptable interactive segmentation (points/boxes)
- Horalix implementation:
  - `interactiveMedsam()` for on-frame prompts
  - Hybrid tracking (MedSAM keyframes + optical flow) via `tracking_method="medsam_hybrid"`
- Parity status: OK (interactive prompts + hybrid tracking).

## SAM 2 (Design Inspiration)
- Primary source: [SAM 2 paper](https://arxiv.org/abs/2408.00714) (promptable segmentation in images + videos with streaming memory).
- Usage in Horalix:
  - Conceptual inspiration for hybrid keyframe + propagation strategy
  - Not directly integrated as a model
- Parity status: INFO (inspiration only; no direct model integration).

---

### Notes / Follow-ups
- If Doppler measurements are required, add a Doppler preprocessor (426x1080 crop) and model runner to align with EchoNet-Measurements Doppler inference.
- Maintain view gating thresholds in `backend/app/services/ai/horalix_ai/utils/view_gating.py` when changing view classifier behavior.
