# DICOM Export Study Design

Date: 2026-02-05

## Scope

Export a study package containing:
- Original DICOM instances
- Derived objects
  - DICOM SR (measurements, EF/metrics, tracking curves)
  - DICOM SEG (segmentations/contours)
  - Optional GSPS/Presentation State (viewport/WL/annotations)

## Current Implementation

- `backend/app/services/dicom/export.py`
  - SR generator for measurements
  - SEG generator (binary masks) using `highdicom`
  - Zip package output

## Required Mapping

Measurements (SR)
- Use `highdicom.sr` with:
  - Measurement Group for each measurement
  - Use UCUM units (mm, mm2, cm, mL, %)
  - Reference Source Image Sequence with SOPInstanceUID + frame number

Tracking (SR)
- Store as waveform-like time series or repeated measurement groups per frame.
- Include frame index and measurement values.

Segmentation (SEG)
- For binary masks, use `highdicom.seg.Segmentation`
- Segment descriptions map to overlay label + color
- Each segment references source instances and frame numbers

Presentation State (optional)
- Store WL/zoom/rotation and annotations for review workflows.

## Metadata

- Preserve Study/Series/Instance UID relationships
- Derived objects get new UIDs but reference originals
- Patient/study metadata copied from originals

## Next Implementation Steps

1) Split export into SR/SEG/PR builders.
2) Validate SR content with `highdicom` classes and DICOM validators.
3) Add re-import path (read SR/SEG -> viewer overlays).
