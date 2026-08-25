import {
  Alert,
  AlertTitle,
  Box,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';

import type { Calibration } from '../../services/calibrationService';
import {
  FORESHORTENING_THRESHOLD,
  bodySurfaceArea,
  buildLongAxis,
  ejectionFraction,
  estimateLongAxisFromContour,
  indexToBsa,
  isForeshortened,
  singlePlaneVolume,
  biplaneVolume,
} from '../../services/ventricleVolumeService';
import type { VolumeMethod, VolumeResult } from '../../services/ventricleVolumeService';
import type { GateResult } from '../../services/viewGatingService';
import { assessLvVolumeProtocol, contourMatchesSlot } from '../../services/lvVolumeProtocolService';
import type { CardiacPhase, MeasurementReviewStatus, Point2D } from '../../types';

/** A traced contour offered as an ED or ES source. */
export interface ContourOption {
  id: string;
  label: string;
  points: Point2D[];
  /** Calibration for the instance this contour belongs to. */
  calibration: Calibration;
  instanceUid: string | null;
  frameIndex: number | null;
  beatKey: string | null;
  /** EchoPrime view label for the instance this was traced on. */
  view: string | null;
  viewConfidence: number | null;
  phase: CardiacPhase | null;
  reviewStatus: MeasurementReviewStatus;
  /** True when first/last trace points are the two mitral annular hinges. */
  hasAnnulusEndpoints: boolean;
  /** Whether the contour was drawn, tracked, or produced by a model. */
  provenance: 'manual' | 'tracked' | 'ai';
}

export interface LvVolumePanelProps {
  method: VolumeMethod;
  onMethodChange: (method: VolumeMethod) => void;

  contours: ContourOption[];

  /** Primary plane (A4C in biplane mode). */
  edContourId: string | null;
  esContourId: string | null;
  onEdContourChange: (id: string | null) => void;
  onEsContourChange: (id: string | null) => void;

  /** Second plane (A2C), biplane mode only. */
  edContourIdB: string | null;
  esContourIdB: string | null;
  onEdContourBChange: (id: string | null) => void;
  onEsContourBChange: (id: string | null) => void;

  calibration: Calibration;
  gate: GateResult;

  heightCm: number | null;
  weightKg: number | null;
  onHeightChange: (value: number | null) => void;
  onWeightChange: (value: number | null) => void;
  onResultChange?: (result: LvQuantificationResult | null) => void;
}

export interface LvQuantificationResult {
  method: VolumeMethod;
  edvMl: number;
  esvMl: number;
  efPercent: number;
  edvIndexMlM2: number | null;
  esvIndexMlM2: number | null;
  reportable: boolean;
  cautions: string[];
}

/** ASE reference ranges for BSA-indexed LV volumes, mL/m². */
const INDEXED_RANGES = {
  edv: { male: [34, 74], female: [29, 61] },
  esv: { male: [11, 31], female: [8, 24] },
};

const formatMl = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(0)} mL`;

const formatMm = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(0)} mm`;

const axisForContour = (contour: ContourOption) => {
  const first = contour.points[0];
  const last = contour.points[contour.points.length - 1];
  const hasDistinctEndpoints =
    first && last && Math.hypot(last.x - first.x, last.y - first.y) > 2;
  return contour.hasAnnulusEndpoints && hasDistinctEndpoints
    ? buildLongAxis(contour.points, first, last)
    : estimateLongAxisFromContour(contour.points);
};

interface VolumeRowProps {
  label: string;
  result: VolumeResult | null;
  indexed: number | null;
}

const VolumeRow: React.FC<VolumeRowProps> = ({ label, result, indexed }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Box sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        {formatMl(result?.volumeMl ?? null)}
      </Typography>
      {indexed !== null && (
        <Typography variant="caption" color="text.secondary">
          {indexed.toFixed(0)} mL/m²
        </Typography>
      )}
    </Box>
  </Box>
);

/**
 * Left ventricular volumes by Simpson's method of disks.
 *
 * Replaces the previous calculator, which read polygon *areas*, labelled them
 * EDV and ESV, and reported their ratio as ejection fraction. That quantity is
 * fractional area change and reads systematically low against real EF.
 */
export const LvVolumePanel: React.FC<LvVolumePanelProps> = ({
  method,
  onMethodChange,
  contours,
  edContourId,
  esContourId,
  onEdContourChange,
  onEsContourChange,
  edContourIdB,
  esContourIdB,
  onEdContourBChange,
  onEsContourBChange,
  calibration,
  gate,
  heightCm,
  weightKg,
  onHeightChange,
  onWeightChange,
  onResultChange,
}) => {
  const byId = useMemo(() => new Map(contours.map((contour) => [contour.id, contour])), [contours]);

  const compute = React.useCallback(
    (primaryId: string | null, secondaryId: string | null): VolumeResult | null => {
      const primary = primaryId ? byId.get(primaryId) : null;
      if (!primary || primary.points.length < 8) return null;
      const primarySpacing = primary.calibration.spacing;
      if (!primarySpacing) return null;

      const primaryAxis = axisForContour(primary);
      if (!primaryAxis) return null;

      if (method === 'single-plane') {
        return singlePlaneVolume(primary.points, primaryAxis, primarySpacing);
      }

      const secondary = secondaryId ? byId.get(secondaryId) : null;
      if (!secondary || secondary.points.length < 8) return null;
      const secondarySpacing = secondary.calibration.spacing;
      if (!secondarySpacing) return null;
      const secondaryAxis = axisForContour(secondary);
      if (!secondaryAxis) return null;

      return biplaneVolume(
        { contour: primary.points, axis: primaryAxis, spacing: primarySpacing },
        { contour: secondary.points, axis: secondaryAxis, spacing: secondarySpacing },
      );
    },
    [byId, method],
  );

  const edv = useMemo(
    () => compute(edContourId, edContourIdB),
    [compute, edContourId, edContourIdB],
  );
  const esv = useMemo(
    () => compute(esContourId, esContourIdB),
    [compute, esContourId, esContourIdB],
  );

  const ef = useMemo(
    () => (edv && esv ? ejectionFraction(edv.volumeMl, esv.volumeMl) : null),
    [edv, esv],
  );

  const bsa = useMemo(
    () => (heightCm && weightKg ? bodySurfaceArea(heightCm, weightKg) : null),
    [heightCm, weightKg],
  );

  const foreshortened = useMemo(() => {
    const flagged = [edv, esv].filter(
      (result): result is Extract<VolumeResult, { method: 'biplane' }> =>
        result?.method === 'biplane',
    );
    return flagged.some(isForeshortened);
  }, [edv, esv]);

  const selections = useMemo(
    () => ({
      a4cEd: edContourId ? (byId.get(edContourId) ?? null) : null,
      a4cEs: esContourId ? (byId.get(esContourId) ?? null) : null,
      a2cEd: edContourIdB ? (byId.get(edContourIdB) ?? null) : null,
      a2cEs: esContourIdB ? (byId.get(esContourIdB) ?? null) : null,
    }),
    [byId, edContourId, esContourId, edContourIdB, esContourIdB],
  );
  const primaryView: 'A4C' | 'A2C' =
    method === 'single-plane' && gate.view === 'A2C' ? 'A2C' : 'A4C';
  const protocol = useMemo(
    () => assessLvVolumeProtocol(method, selections, primaryView),
    [method, primaryView, selections],
  );
  const selectionKey = [method, edContourId, esContourId, edContourIdB, esContourIdB].join('|');
  const [reviewedSelectionKey, setReviewedSelectionKey] = useState<string | null>(null);
  const operatorReviewed = reviewedSelectionKey === selectionKey;
  const reportable = protocol.complete && operatorReviewed && !foreshortened && ef !== null;

  useEffect(() => {
    if (!onResultChange) return;
    if (!edv || !esv || ef === null) {
      onResultChange(null);
      return;
    }
    onResultChange({
      method,
      edvMl: edv.volumeMl,
      esvMl: esv.volumeMl,
      efPercent: ef,
      edvIndexMlM2: indexToBsa(edv.volumeMl, bsa),
      esvIndexMlM2: indexToBsa(esv.volumeMl, bsa),
      reportable,
      cautions: [
        ...protocol.cautions,
        ...(foreshortened ? ['Possible apical foreshortening.'] : []),
      ],
    });
  }, [bsa, edv, ef, esv, foreshortened, method, onResultChange, protocol.cautions, reportable]);

  /**
   * The same measurement taken from the other source.
   *
   * Where the operator traced by hand, this is the model's contour for the same
   * phase and view, and vice versa. Divergence between the two is the most
   * useful quality signal either one produces -- and the one thing a fully
   * automated pipeline cannot give you.
   */
  const crossCheck = useMemo(() => {
    const primary = edContourId ? byId.get(edContourId) : null;
    if (!primary) return null;

    const wanted = primary.provenance === 'ai' ? 'manual' : 'ai';
    const counterpartEd = contours.find(
      (option) =>
        option.provenance === wanted &&
        option.instanceUid === primary.instanceUid &&
        option.phase === primary.phase &&
        option.view === primary.view &&
        option.id !== edContourId,
    );
    const esPrimary = esContourId ? byId.get(esContourId) : null;
    const counterpartEs = contours.find(
      (option) =>
        option.provenance === wanted &&
        option.instanceUid === esPrimary?.instanceUid &&
        option.phase === esPrimary?.phase &&
        option.view === esPrimary?.view &&
        option.id !== esContourId,
    );
    if (!counterpartEd || !counterpartEs) return null;

    const otherEdv = compute(counterpartEd.id, edContourIdB);
    const otherEsv = compute(counterpartEs.id, esContourIdB);
    if (!otherEdv || !otherEsv) return null;

    const otherEf = ejectionFraction(otherEdv.volumeMl, otherEsv.volumeMl);
    if (otherEf === null || ef === null) return null;

    return {
      source: wanted as ContourOption['provenance'],
      edvMl: otherEdv.volumeMl,
      esvMl: otherEsv.volumeMl,
      ef: otherEf,
      efDelta: Math.abs(otherEf - ef),
    };
  }, [byId, contours, compute, edContourId, esContourId, edContourIdB, esContourIdB, ef]);

  const provenance = useMemo(() => {
    const ids = [edContourId, esContourId, edContourIdB, esContourIdB].filter((id): id is string =>
      Boolean(id),
    );
    const sources = new Set(ids.map((id) => byId.get(id)?.provenance).filter(Boolean));
    return Array.from(sources) as ContourOption['provenance'][];
  }, [byId, edContourId, esContourId, edContourIdB, esContourIdB]);

  const calibrationSummary = useMemo(() => {
    const ids = [edContourId, esContourId];
    if (method === 'biplane') ids.push(edContourIdB, esContourIdB);

    const selected = ids
      .filter((id): id is string => Boolean(id))
      .map((id) => byId.get(id)?.calibration)
      .filter((value): value is Calibration => Boolean(value));
    const calibrations = selected.length > 0 ? selected : [calibration];
    const labels = calibrations.map((value) => {
      const source = value.source.replace(/_/g, ' ');
      if (!value.spacing) return source;
      return `${source} · ${value.spacing.rowSpacing.toFixed(3)} × ${value.spacing.columnSpacing.toFixed(3)} mm/px`;
    });
    return Array.from(new Set(labels)).join('; ');
  }, [byId, calibration, edContourId, esContourId, edContourIdB, esContourIdB, method]);

  if (!gate.allowed) {
    return (
      <Alert severity="warning">
        <AlertTitle>Volumes unavailable</AlertTitle>
        {gate.reason ?? 'Simpson’s method does not apply to this view.'}
      </Alert>
    );
  }

  const renderPicker = (
    label: string,
    value: string | null,
    onChange: (id: string | null) => void,
    expectedView: 'A4C' | 'A2C',
    expectedPhase: 'ED' | 'ES',
  ) => (
    <FormControl size="small" fullWidth>
      <InputLabel id={`lv-${label}`}>{label}</InputLabel>
      <Select
        labelId={`lv-${label}`}
        label={label}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? String(event.target.value) : null)}
      >
        <MenuItem value="">
          <em>Not selected</em>
        </MenuItem>
        {contours
          .filter((contour) => contourMatchesSlot(contour, expectedView, expectedPhase))
          .map((contour) => (
            <MenuItem key={contour.id} value={contour.id}>
              {contour.label}
              {contour.view ? ` · ${contour.view}` : ''}
              {contour.frameIndex !== null ? ` · frame ${contour.frameIndex + 1}` : ''}
            </MenuItem>
          ))}
      </Select>
    </FormControl>
  );

  return (
    <Stack spacing={2} data-testid="lv-volume-panel">
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Method
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={method}
          onChange={(_, next: VolumeMethod | null) => next && onMethodChange(next)}
        >
          <Tooltip title="Two apical views. The reference standard; does not assume the ventricle is rotationally symmetric.">
            <span>
              <ToggleButton value="biplane" disabled={gate.capability.biplane === 'unsupported'}>
                Biplane (A4C × A2C)
              </ToggleButton>
            </span>
          </Tooltip>
          <Tooltip title="One apical view. Each disk is assumed circular.">
            <span>
              <ToggleButton
                value="single-plane"
                disabled={gate.capability.singlePlane === 'unsupported'}
              >
                Single plane
              </ToggleButton>
            </span>
          </Tooltip>
        </ToggleButtonGroup>
      </Box>

      {gate.reason && (
        <Alert severity={gate.confident ? 'info' : 'warning'} variant="outlined">
          {gate.reason}
        </Alert>
      )}

      <Alert severity="info" variant="outlined">
        Trace from one mitral hinge through the compacted LV endocardium and apex to the other
        hinge, then close across the annulus. Papillary muscles stay outside the cavity. Use the
        largest cavity after mitral closure for ED and the smallest cavity before mitral opening for
        ES, from the same beat.
      </Alert>

      <Divider />

      <Stack spacing={1.5}>
        <Typography variant="subtitle2">
          {method === 'biplane' ? 'Apical 4-chamber' : 'Traced view'}
        </Typography>
        {renderPicker('End-diastole', edContourId, onEdContourChange, primaryView, 'ED')}
        {renderPicker('End-systole', esContourId, onEsContourChange, primaryView, 'ES')}
      </Stack>

      {method === 'biplane' && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Apical 2-chamber</Typography>
          {renderPicker('End-diastole (A2C)', edContourIdB, onEdContourBChange, 'A2C', 'ED')}
          {renderPicker('End-systole (A2C)', esContourIdB, onEsContourBChange, 'A2C', 'ES')}
        </Stack>
      )}

      <Divider />

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          label="Height"
          type="number"
          value={heightCm ?? ''}
          onChange={(event) =>
            onHeightChange(event.target.value ? Number(event.target.value) : null)
          }
          InputProps={{ endAdornment: <Typography variant="caption">cm</Typography> }}
        />
        <TextField
          size="small"
          label="Weight"
          type="number"
          value={weightKg ?? ''}
          onChange={(event) =>
            onWeightChange(event.target.value ? Number(event.target.value) : null)
          }
          InputProps={{ endAdornment: <Typography variant="caption">kg</Typography> }}
        />
      </Stack>
      {bsa === null && (
        <Typography variant="caption" color="text.secondary">
          Enter height and weight to index volumes to body surface area. Absolute volumes do not
          classify on their own.
        </Typography>
      )}

      {foreshortened && (
        <Alert severity="warning">
          <AlertTitle>Possible foreshortening</AlertTitle>
          The two apical views disagree on the long axis by more than{' '}
          {(FORESHORTENING_THRESHOLD * 100).toFixed(0)}%. One of them is likely foreshortened; check
          both traces before reporting.
        </Alert>
      )}

      {protocol.blocking.length > 0 && (
        <Alert severity="error" data-testid="lv-protocol-blocking">
          <AlertTitle>Not reportable yet</AlertTitle>
          {protocol.blocking.map((message) => (
            <Typography key={message} variant="body2">
              • {message}
            </Typography>
          ))}
        </Alert>
      )}
      {protocol.cautions.length > 0 && (
        <Alert severity="warning" variant="outlined" data-testid="lv-protocol-cautions">
          <AlertTitle>Operator confirmation required</AlertTitle>
          {protocol.cautions.map((message) => (
            <Typography key={message} variant="body2">
              • {message}
            </Typography>
          ))}
        </Alert>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={operatorReviewed}
            disabled={!protocol.complete || !edv || !esv || ef === null || foreshortened}
            onChange={(event) =>
              setReviewedSelectionKey(event.target.checked ? selectionKey : null)
            }
          />
        }
        label="I reviewed both views, ED/ES phases, annular endpoints, apex, and endocardial borders"
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <VolumeRow
            label="LVEDV"
            result={edv}
            indexed={edv ? indexToBsa(edv.volumeMl, bsa) : null}
          />
          <VolumeRow
            label="LVESV"
            result={esv}
            indexed={esv ? indexToBsa(esv.volumeMl, bsa) : null}
          />

          <Divider />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Ejection fraction
            </Typography>
            {ef === null ? (
              <Typography variant="h6">—</Typography>
            ) : (
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {ef.toFixed(0)}%
                </Typography>
                <Chip
                  size="small"
                  color={reportable ? 'success' : 'warning'}
                  label={reportable ? 'Reviewed' : 'Calculated · not reportable'}
                />
              </Stack>
            )}
          </Box>

          {(edv || esv) && (
            <>
              <Divider />
              <Typography variant="caption" color="text.secondary" component="div">
                <strong>Method:</strong>{' '}
                {method === 'biplane'
                  ? 'Simpson’s biplane, 20 disks'
                  : 'Simpson’s single plane, 20 disks'}
                <br />
                <strong>Long axis:</strong> ED {formatMm(edv?.longAxisMm)} · ES{' '}
                {formatMm(esv?.longAxisMm)}
                <br />
                <strong>Calibration:</strong> {calibrationSummary}
                <br />
                <strong>View:</strong> {gate.view}
                {gate.confident ? ' (confident)' : ' (unconfirmed)'}
                {provenance.length > 0 && (
                  <>
                    <br />
                    <strong>Contours:</strong> {provenance.join(', ')}
                  </>
                )}
              </Typography>
            </>
          )}
        </Stack>
      </Paper>

      {crossCheck && (
        <Paper
          variant="outlined"
          sx={{ p: 2, borderColor: crossCheck.efDelta > 10 ? 'warning.main' : undefined }}
          data-testid="lv-cross-check"
        >
          <Typography variant="subtitle2" gutterBottom>
            {crossCheck.source === 'ai' ? 'Model contours' : 'Manual trace'}, same case
          </Typography>
          <Stack direction="row" spacing={2} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                LVEDV
              </Typography>
              <Typography variant="body2">{formatMl(crossCheck.edvMl)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                LVESV
              </Typography>
              <Typography variant="body2">{formatMl(crossCheck.esvMl)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                EF
              </Typography>
              <Typography variant="body2">{crossCheck.ef.toFixed(0)}%</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Difference
              </Typography>
              <Typography
                variant="body2"
                color={crossCheck.efDelta > 10 ? 'warning.main' : 'text.primary'}
              >
                {crossCheck.efDelta.toFixed(0)} pts
              </Typography>
            </Box>
          </Stack>
          {crossCheck.efDelta > 10 && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
              The two sources disagree by more than 10 EF points. Review both contours before
              reporting; one of them is tracing something other than the endocardial border.
            </Typography>
          )}
        </Paper>
      )}

      {bsa !== null && edv && (
        <Typography variant="caption" color="text.secondary">
          Reference (ASE, indexed): LVEDV {INDEXED_RANGES.edv.female[0]}–
          {INDEXED_RANGES.edv.male[1]} mL/m², LVESV {INDEXED_RANGES.esv.female[0]}–
          {INDEXED_RANGES.esv.male[1]} mL/m². Ranges are sex-specific; confirm against your lab’s.
        </Typography>
      )}
    </Stack>
  );
};

export default LvVolumePanel;
