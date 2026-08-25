# Changelog

All notable changes to the Horalix View project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed - measurement correctness

These change numbers a clinician would act on.

- **Ultrasound images are now spatially calibrated.** The DICOM parser read only
  `PixelSpacing` (0028,0030), which echo studies usually do not carry - their
  calibration lives in `SequenceOfUltrasoundRegions`. `instance.pixel_spacing`
  came back null and the viewer fell back to `[1, 1]` in four places, so every
  manual length and area on those studies was a pixel count labelled **mm** or
  **mm2**. Added `services/dicom/calibration.py` as the single resolver: it
  prefers a 2D tissue region whose axes are both in centimetres, rejects M-mode
  and spectral Doppler regions (whose X axis is *time*), and prefers the region
  containing the image centre. An image with no usable calibration resolves to
  `source="none"`, and the viewer reports **px** behind a visible "Uncalibrated
  image" banner rather than silently pretending 1 px is 1 mm.
- **LV volumes use Simpson's method of disks.** The EF calculator read polygon
  *areas*, labelled them EDV and ESV, and reported their ratio as ejection
  fraction. That quantity is fractional area change; because volume scales with
  roughly area^1.5 it reads systematically low - a true EF near 60% displayed as
  about 45%, across the normal/reduced boundary. Replaced with a real disk
  summation offering single-plane and biplane (A4C x A2C), gated on the
  EchoPrime view classifier, with BSA indexing, a foreshortening check, and
  provenance on every reported value.
- **The AI pipeline's long axis is measured, not assumed.** LV volume used
  `L = sqrt(A) * 1.5` - a fixed shape constant - inside the area-length formula.
  EF partly survived because the constant cancels between ED and ES; the
  millilitre volumes did not. It now fits a disk stack to the mask, with the
  long axis derived from the mask's principal axis.
- **`compute_volume_from_area` no longer calls itself Simpson's.** It implements
  the area-length (Dodge) formula; the parameter is now `area_length`, and a
  zero or negative length is rejected rather than divided by.
- **Removed the guessed ultrasound spacing.** The worker defaulted
  `PhysicalDeltaX` to `0.015` cm/px and fell back to `(0.15, 0.15)`. A cine with
  no usable calibration is now skipped and logged.
- **ED/ES come from a single beat.** Phase detection took the global maximum and
  minimum of the tracked curve, so a multi-beat clip could pair the end-diastole
  of one beat with the end-systole of another, and one ectopic or badly-tracked
  beat captured both. The curve is now segmented into beats by autocorrelation
  and the best-tracked beat is reported, with the beat count shown in the UI.
- **Tracked measurements report null instead of false millimetres.** The
  tracking endpoint fell back to 1 mm/px; it now returns `calibrated: false`
  with null length and area on an uncalibrated series.

### Performance

- **Broke a transitive eager-load cascade.** `Patient.studies`,
  `Study.series_list`/`ai_jobs` and `Series.instances` were all
  `lazy="selectin"` and chained: listing 20 patients pulled every study, every
  series, and **every instance row** beneath them. All four are now
  `lazy="raise"` with `passive_deletes=True` where the database already
  cascades; every endpoint needing children already used explicit
  `selectinload`.
- **Auth tokens are out of image URLs.** `getPixelDataUrl` appended the JWT as a
  query parameter, making the token part of the browser's cache key - so a token
  refresh invalidated every cached frame in the study at once, and wrote the
  token into access logs and browser history. Image routes now authenticate via
  an HttpOnly `SameSite=Strict` cookie scoped to `/api/v1`, so image URLs are
  stable across sessions. The query parameter is still accepted for previously
  issued links.
- **Window/level no longer re-renders the clip server-side per mouse-move.**
  Each distinct window/level pair is a separate render cache key, so a drag
  queued a fresh PNG encode for every prefetched frame on every tick. The drag
  now previews through a CSS filter and commits one server render on release.
- **Concurrent requests for the same clip decode it once.** The prefetcher fires
  several frame requests in parallel and all land on the same file; each was
  decoding the entire multi-frame array independently. Added single-flight
  locking around the decode.
- **Raised the decoded-pixel cache from 16 entries to 256.** With 16, a session
  with more open cines than that evicted the earliest, and scrubbing back
  re-decoded the whole clip. The byte ceiling is the real constraint.
- **Removed six unused imaging libraries** (`cornerstone-core`,
  `cornerstone-math`, `cornerstone-tools`, `cornerstone-wado-image-loader`,
  `dicom-parser`, `vtk.js`) and their `optimizeDeps`/`manualChunks` entries -
  200 packages. Rollup was already tree-shaking them out of the bundle, so this
  is an install, CI and dev-server win rather than a shipped-bytes one.

### Performance - whole-cine delivery

- **A cine is now one request and one decode.** Added
  `GET /instances/{uid}/clip`, which returns every frame of a multi-frame
  instance tiled into a single image, with the grid geometry in response headers
  so the body stays a plain image the browser decodes natively. The viewer draws
  frames from the sheet onto a canvas, so scrubbing and playback cost no network
  at all, and the per-frame prefetch is skipped entirely once a sheet is loaded.
  Falls back to the per-frame path for single-frame instances, clips past the
  size cap, and any fetch failure; there is a settings toggle to force the old
  path. JPEG chroma subsampling is disabled for sheets, since the tile grid has
  hard edges that 4:2:0 would bleed between neighbouring frames.
- **AI results and the model roster moved to React Query.** Both were read from
  several places and re-fetched with no caching. Loading a model now invalidates
  the roster rather than refetching it by hand, and the bootstrap fetches seed
  the query cache so the queries resolve without a second round trip. Study and
  series loading deliberately stay imperative: they are entangled with
  `selectSeries`'s side effects, and splitting that is a separate change.

### Changed - structure

- **Viewer preferences are declared once.** Sixteen `useState` calls, a
  load-from-localStorage effect and a save-to-localStorage effect each carried
  their own hand-maintained list, so adding a preference meant editing three
  places and missing one produced a setting that silently forgot itself.
  `useViewerPreferences` now derives reading, writing, parsing and clamping from
  a single schema, with a compile-time check that the schema stays exhaustive.
  Corrupt values fall back per key rather than discarding the whole set, and
  blocked site data yields defaults instead of throwing. `ViewerPage` is down
  from 114 `useState` hooks to 99.
- **Fixed a crash on single-valued WindowCenter.** WindowCenter and WindowWidth
  are VM 1-n: pydicom returns a bare `DSfloat` for one value and a `MultiValue`
  for several. The upload path indexed `[0]` unconditionally, so any DICOM
  carrying a single window value failed the whole upload with
  "'DSfloat' object is not subscriptable".

### Added - validation

- **A harness for comparing measurements against a reference method.** Testing
  the volume code against analytic geometry proves the arithmetic; it says
  nothing about agreement with cardiac MR, or with the package a reading room
  already trusts, on real ventricles. `services/validation/agreement.py` reports
  Bland-Altman bias and limits of agreement, Lin's concordance, ICC(2,1) and an
  OLS fit, and `scripts/validate_measurements.py` runs it over a CSV of paired
  measurements. Correlation is reported only alongside concordance, never
  instead of it: two methods can correlate almost perfectly while one reads 20
  mL high, and a gap between the two figures is exactly that offset. Tolerances
  are supplied by the reviewer rather than assumed, and the script exits
  non-zero only against a stated tolerance -- without one it reports rather than
  pretending to a verdict. This does not answer the validation question; it
  makes answering it a matter of supplying data.

### Changed - structure

- **AI job polling is a tested service, and can now be cancelled.** The loop in
  the page had no cancellation at all: navigating away from a study left it
  polling until the job finished or the timeout elapsed. `aiJobService` handles
  the terminal-state set, progress reporting and a bounded deadline, aborts on
  study change and unmount, and distinguishes a cancelled wait (say nothing --
  the user left deliberately, and the job continues server-side) from a timeout
  (say the job is still running) from a real failure. It also no longer spends
  an extra poll interval past the deadline on its way out.

### Added - cross-checking

- **Manual and model volumes are shown side by side.** When both a hand trace
  and a model contour exist for the same phase and view, the panel reports both
  and their EF difference, flagging a gap beyond 10 points. Divergence between
  the two is the most useful quality signal either produces, and the one thing a
  fully automated pipeline cannot give you.
- **Startup warns about uncalibrated instances.** Studies ingested before
  migration 003 never had their ultrasound calibration captured, so the
  migration alone cannot fix them -- they need re-ingesting. The server now
  counts them at startup and says so, rather than leaving it to be discovered
  when a measurement reads in pixels.

### Added - tracing

- **Freehand is a real tool.** It was fully declared in `tool.types.ts` (icon,
  cursor, shortcut `F`) but absent from the toolbar, reachable only by holding
  the *right* mouse button while the polygon tool was active.
- **Strokes are drawn off the React tree.** Each sampled point called
  `setActivePolygon`, re-rendering an 8,000-line component with 105 `useState`
  hooks dozens of times per second. The live stroke now lives in a ref and is
  painted by mutating SVG path attributes inside a `requestAnimationFrame` loop.
- **Sampling is screen-space**, so stroke density no longer changes with zoom.
- **Simplify and smooth on commit** (Ramer-Douglas-Peucker, then Chaikin), never
  mid-stroke, which would fight the operator's hand.
- **Segment redraw**: a stroke that starts and ends on an existing contour
  splices into it, replacing the shorter arc - so a border the tracker got
  slightly wrong is fixable without retracing the whole thing.
- **Live area readout** while tracing, in the units the calibration allows.
- **Optional magnetic snap** onto the nearest intensity edge along the contour
  normal. Points with no gradient in range stay exactly where they were drawn.

### Changed

- **One tool vocabulary.** `ViewerTool` and `ViewerToolId` disagreed, and a
  third shortcut table lived in `editingTransitions.ts`. `polyline`, `ellipse`
  and `rectangle` were typed, configured, tested and unreachable. Tools are now
  declared once in `domain/tools.ts`; the toolbar derives from that list.
- **A failed series load no longer retries forever.** The smart-hang effect
  depended on the state it wrote, and a series that threw was only logged - so
  it stayed in the target list and re-fired on every re-run.
- **Fixed `shlex.split` destroying Windows paths** in the external model runner:
  POSIX mode treats a backslash as an escape, so a Windows path lost its
  separators and the process failed to launch.
- Suites: backend 170 passing, frontend 313 passing, lint and typecheck clean,
  production build succeeds.

## [1.0.0] - 2026-01-19

### 🎉 Production Release

This release represents the final polish and production-readiness of Horalix View as a hospital-grade DICOM viewer and AI platform. All placeholder code has been removed, full database persistence is implemented, and the system is ready for clinical deployment.

### ✨ Added

#### Database & Persistence
- **Annotation Database Persistence**: Replaced in-memory annotation storage with full PostgreSQL persistence
  - Created `Annotation` SQLAlchemy model with all required fields (geometry, measurements, labels, etc.)
  - Added Alembic migration `002_add_annotations_table` for database schema
  - Implemented full CRUD operations with database transactions
  - Added indexes for efficient querying by study/series/instance UIDs
  - Support for locking mechanism and visibility controls

#### Documentation
- **Comprehensive README**: Complete production-ready documentation
  - Architecture diagrams and technology stack details
  - Detailed setup instructions for development and production
  - AI models download and configuration guide
  - Database migration procedures
  - Deployment guides with Docker and HTTPS setup
  - Monitoring, logging, and backup procedures
  - API documentation with key endpoints

#### Configuration
- **Enhanced Environment Variables**: Expanded `.env.example` with all required settings
  - Strong secret key generation instructions
  - Complete database and Redis URL configuration
  - Comprehensive AI configuration options (device, batch size, thresholds)
  - HIPAA compliance settings
  - Clear documentation for each variable

### 🔧 Changed

#### Docker Configuration
- **Backend Dockerfile**: Replaced deprecated `libgl1-mesa-glx` with `libgl1` for Debian compatibility
  - Added additional system dependencies for PyTorch, MONAI, OpenCV (libgomp1, libsm6, libxext6, etc.)
  - Improved comment clarity for dependency purposes

- **Frontend Dockerfile**: Relocated nginx configuration file
  - Moved `nginx.conf` from `docker/` to `frontend/docker/` for proper build context
  - Updated COPY path in Dockerfile to reference correct location
  - Ensures multi-stage build works correctly

- **docker-compose.yml**: Removed obsolete `version:` key (Docker Compose V2 compatibility)
  - Modern compose file format without version specification
  - Verified all service contexts and volume mappings

#### Dependency Management
- **Backend Dependencies**: Fixed potential compatibility issues
  - Pinned `bcrypt` to `<4.0.0` (from `<4.1.0`) to avoid passlib incompatibilities on Windows/Python 3.12
  - Verified `email-validator>=2.1.0` is present for EmailStr validation
  - Maintained all other dependencies with appropriate version constraints

#### Frontend TypeScript
- **Strict TypeScript Compliance**: Fixed all unused variable and parameter errors
  - `MainLayout.tsx`: Removed unused `mode` variable from useTheme destructuring
  - `SettingsPage.tsx`: Removed unused `mode` variable and `Divider` import
  - `PatientListPage.tsx`: Removed unused `Button` import
  - `StudyListPage.tsx`: Removed unused `result` variable from upload handler
  - `cornerstone.ts`: Prefixed unused parameters with underscore (`_element`, `_image`, `_windowCenter`, `_windowWidth`)
  - All files now pass strict TypeScript compilation without disabling rules

#### API Endpoints
- **Annotations API**: Complete rewrite for database persistence
  - Converted from in-memory `ANNOTATIONS_DB` dict to SQLAlchemy queries
  - Implemented proper async/await patterns with database sessions
  - Added conversion functions between Pydantic and SQLAlchemy models
  - Maintained full API compatibility with frontend
  - Enhanced error messages and status codes
  - Proper transaction handling with commit/rollback

### 🐛 Fixed

- **Docker Build Issues**: Resolved package availability problems on Debian trixie
- **Frontend Build Issues**: Eliminated TypeScript compilation errors
- **Annotation Persistence**: Replaced temporary in-memory storage with permanent database storage
- **Environment Configuration**: Ensured all required variables are documented and validated

### 🔒 Security

- **Secret Key Management**: Added explicit warnings and instructions for generating secure keys
- **Default Values**: Removed any default secret keys that could be accidentally used in production
- **Environment Validation**: Enhanced configuration validation to prevent weak security settings

### 📊 Database

#### Migrations
- `001_initial_schema`: Base database schema (patients, studies, series, instances, users, jobs, audit logs)
- `002_add_annotations_table`: Annotation persistence with full metadata support
  - 17 fields including UIDs, geometry (JSON), measurements (JSON), visibility, locking
  - 8 indexes for efficient querying
  - Foreign key relationship to users table
  - Proper enum type for annotation types

#### Schema Changes
- Added `annotations` table with comprehensive fields for clinical annotation workflows
- Indexes optimized for common query patterns (study UID, series UID, instance UID, created_at DESC)
- JSON fields for flexible geometry and measurement storage

### 🧪 Testing

- **Test Infrastructure**: Enhanced test organization and coverage areas
  - Unit tests for configuration and models
  - Service tests for AI models and DICOM parsing
  - Integration tests for upload pipelines and AI inference
  - Clear test structure documented in README

### 📝 Technical Improvements

#### AI Configuration
- Environment-driven AI settings (device selection, batch size, precision, thresholds)
- Configurable model directory via `AI_MODELS_DIR`
- Enable/disable AI features via `AI_ENABLED` flag
- Concurrent job limits and confidence thresholds

#### Database Performance
- Composite indexes for multi-column queries
- Proper foreign key cascades (DELETE CASCADE for dependent records)
- Optimized query patterns with SELECT IN and JOIN strategies

#### Code Quality
- Eliminated all TypeScript `noUnusedLocals` and `noUnusedParameters` violations
- Maintained strict typing without compromising functionality
- Clear separation of concerns between Pydantic schemas and SQLAlchemy models
- Proper async/await patterns throughout the backend

### 🚀 Deployment

- **Production-Ready**: All components tested and verified for clinical deployment
- **Docker Support**: Complete containerization with health checks
- **Database Migrations**: Alembic migrations ready to run in production
- **Monitoring**: Prometheus metrics, structured logging, health endpoints
- **Backup Procedures**: Documented database and file backup/restore procedures

### 📋 Breaking Changes

None - this release maintains full backward compatibility with existing deployments.

### 🔄 Migration Guide

For existing deployments:

1. **Pull latest code**:
   ```bash
   git pull origin main
   ```

2. **Update dependencies**:
   ```bash
   cd backend
   pip install -e "."
   ```

3. **Run database migration**:
   ```bash
   alembic upgrade head
   ```

4. **Restart services**:
   ```bash
   docker-compose restart
   ```

5. **Verify annotation persistence**:
   ```bash
   curl http://localhost:8000/api/v1/annotations
   ```

### 📦 Dependencies

#### Backend
- Python 3.10 - 3.12 supported
- FastAPI 0.109+
- SQLAlchemy 2.0.25+
- bcrypt 3.2.0 - 3.9.9 (pinned <4.0.0)
- PyTorch 2.2.0+
- MONAI 1.3.0+
- Ultralytics 8.1.0+

#### Frontend
- Node.js 18+
- React 18
- TypeScript 5+
- Material-UI 5
- Cornerstone.js

### 🙏 Contributors

This release includes contributions from the Horalix development team and the open-source community.

### 📊 Statistics

- **47 files changed**
- **Database tables**: 8 (added 1 new: annotations)
- **API endpoints**: 45+ (including new annotation endpoints)
- **Docker services**: 4 (backend, frontend, postgres, redis)
- **TypeScript errors fixed**: 12+
- **Documentation pages**: 750+ lines of comprehensive README

---

## [0.9.0] - 2025-01-15

### Added
- Initial real AI inference implementation
- YOLOv8, MONAI, and MedSAM model integrations
- Removed all placeholder/mock AI code
- Database schema with Alembic migrations
- FastAPI backend with async SQLAlchemy
- React TypeScript frontend with Material-UI
- DICOM upload and parsing
- Study/Series/Instance management
- User authentication and authorization
- Audit logging for HIPAA compliance

### Changed
- Replaced placeholder AI models with real implementations
- Migrated from mock data to actual database queries
- Implemented async job processing for AI inference

---

## [0.5.0] - 2024-12-01

### Added
- Initial project structure
- Basic DICOM viewer with Cornerstone.js
- DICOMweb protocol support
- Simple frontend with viewer controls

---

## [0.1.0] - 2024-11-01

### Added
- Project initialization
- Technology stack selection
- Architecture design

---

[1.0.0]: https://github.com/horalix/horalix-view/releases/tag/v1.0.0
[0.9.0]: https://github.com/horalix/horalix-view/releases/tag/v0.9.0
[0.5.0]: https://github.com/horalix/horalix-view/releases/tag/v0.5.0
[0.1.0]: https://github.com/horalix/horalix-view/releases/tag/v0.1.0
