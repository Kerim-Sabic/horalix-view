# QA Checklist

Date: 2026-02-05

## Manual QA (Viewer)

- Load study and verify series list + thumbnails.
- Cine playback smoothness at multiple FPS.
- Switch cines rapidly; ensure frames update instantly.
- Measurement tools: create line + polygon, edit endpoints, delete.
- Tracking: verify tracking across cine and area metrics update.
- Import measurements: appear and render on correct frame.
- Export measurements: JSON/CSV/PDF/DICOM SR.
- Overlays: AI overlays show on correct frame and cine; toggle works.

## Manual QA (AI)

- Run Horalix AI on a study with multiple cines.
- Verify progress is monotonic and finishes.
- Verify view chips navigate to corresponding cines.
- Check EF + LV metrics display; no zeros for absence (use Absent/Present labels).
- Verify measurements generated on all frames.

## Automated QA

- Frontend: `npm test` + `npm run type-check` + `npm run lint`
- Backend: `pytest` + `ruff` + `black` + `mypy`

## Regression Notes

- Any changes to coordinate transforms must be validated against a reference study.
- Any changes to AI output normalization must preserve overlay targets.
