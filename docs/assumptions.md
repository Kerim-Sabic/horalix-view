# Assumptions

Date: 2026-02-05

- DICOM frames are 0-indexed internally; overlays target `frame_index` in 0-based coordinates.
- Overlay coordinates are in original DICOM pixel space (rows x columns).
- PanEcho uses 16 frames per instance and ImageNet normalization (224x224).
- EchoNet Dynamic uses 112x112 preprocessing and runs only on A4C/A2C views.
- Measurements models expect 640x480 input and require batched inference for all frames.
- Viewer cine grouping: ultrasound multi-instance => instance-based cine; otherwise series-based.
- Export SR/SEG will be generated with highdicom using explicit VR little endian.
