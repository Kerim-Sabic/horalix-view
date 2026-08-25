import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';

import {
  assessMeasurementProtocol,
  getEchoMeasurementProtocol,
} from '../../domain/echoMeasurementProtocol';
import {
  calculateLvotHemodynamics,
  deriveLvLinearQuantification,
  findLvotDiameter,
} from '../../services/echoQuantificationService';
import { bodySurfaceArea } from '../../services/ventricleVolumeService';
import type { Measurement, TrackingData } from '../../types';

export interface EchoQuantificationPanelProps {
  measurements: Measurement[];
  trackingById: ReadonlyMap<string, TrackingData>;
  heightCm: number | null;
  weightKg: number | null;
  lvotVtiCm: number | null;
  heartRateBpm: number | null;
  onLvotVtiChange: (value: number | null) => void;
  onHeartRateChange: (value: number | null) => void;
  onAcceptMeasurements: (ids: string[]) => void;
}

const format = (value: number | null, unit: string, digits = 1) =>
  value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)} ${unit}`;

const MeasurementInput: React.FC<{ measurement: Measurement | null; fallback: string }> = ({
  measurement,
  fallback,
}) => {
  if (!measurement) return <Chip size="small" color="warning" label={`${fallback} missing`} />;
  const protocol = getEchoMeasurementProtocol(measurement.clinicalRole);
  const assessment = assessMeasurementProtocol(measurement);
  const reviewed =
    measurement.reviewStatus === 'accepted' || measurement.reviewStatus === 'modified';
  return (
    <Chip
      size="small"
      color={assessment.compatible && reviewed ? 'success' : 'warning'}
      variant={reviewed ? 'filled' : 'outlined'}
      label={`${protocol?.shortLabel ?? fallback} · ${reviewed ? 'reviewed' : 'review needed'}`}
    />
  );
};

export const EchoQuantificationPanel: React.FC<EchoQuantificationPanelProps> = ({
  measurements,
  trackingById,
  heightCm,
  weightKg,
  lvotVtiCm,
  heartRateBpm,
  onLvotVtiChange,
  onHeartRateChange,
  onAcceptMeasurements,
}) => {
  const linear = useMemo(
    () => deriveLvLinearQuantification(measurements, trackingById),
    [measurements, trackingById],
  );
  const lvotDiameter = useMemo(() => findLvotDiameter(measurements), [measurements]);
  const bsa = useMemo(
    () => (heightCm && weightKg ? bodySurfaceArea(heightCm, weightKg) : null),
    [heightCm, weightKg],
  );
  const lvot = useMemo(
    () =>
      lvotDiameter?.lengthMm && lvotVtiCm
        ? calculateLvotHemodynamics(lvotDiameter.lengthMm, lvotVtiCm, heartRateBpm, bsa)
        : null,
    [bsa, heartRateBpm, lvotDiameter, lvotVtiCm],
  );

  const plaxInputs = Array.from(
    new Map(
      [linear.lvedd, linear.lvesd, linear.ivsd, linear.lvpwd]
        .filter(
          (measurement): measurement is NonNullable<typeof measurement> => measurement !== null,
        )
        .map((measurement) => [measurement.id, measurement]),
    ).values(),
  );
  const unreviewedPlax = plaxInputs.filter(
    (measurement) =>
      measurement.reviewStatus !== 'accepted' && measurement.reviewStatus !== 'modified',
  );
  const plaxProtocolWarnings = plaxInputs.flatMap((measurement) =>
    assessMeasurementProtocol(measurement).warnings.map(
      (warning) =>
        `${getEchoMeasurementProtocol(measurement.clinicalRole)?.shortLabel}: ${warning}`,
    ),
  );
  const canAcceptPlax = unreviewedPlax.length > 0 && plaxProtocolWarnings.length === 0;

  const vtiReviewKey = lvotVtiCm === null ? null : String(lvotVtiCm);
  const [reviewedVtiKey, setReviewedVtiKey] = useState<string | null>(null);
  const vtiReviewed = vtiReviewKey !== null && reviewedVtiKey === vtiReviewKey;
  const lvotReviewed =
    lvotDiameter?.reviewStatus === 'accepted' || lvotDiameter?.reviewStatus === 'modified';
  const lvotReportable = Boolean(lvot && lvotReviewed && vtiReviewed);

  return (
    <Stack spacing={2} data-testid="echo-quantification-panel">
      <Box>
        <Typography variant="h6">PLAX linear quantification</Typography>
        <Typography variant="body2" color="text.secondary">
          Explicit roles and clinician review are required. Measurements are never inferred from
          whichever line is visible.
        </Typography>
      </Box>

      <Stack direction="row" gap={0.75} flexWrap="wrap">
        <MeasurementInput measurement={linear.lvedd} fallback="LVEDD / tracked LVID" />
        {linear.lvesd?.id !== linear.lvedd?.id && (
          <MeasurementInput measurement={linear.lvesd} fallback="LVESD" />
        )}
        <MeasurementInput measurement={linear.ivsd} fallback="IVSd" />
        <MeasurementInput measurement={linear.lvpwd} fallback="LVPWd" />
      </Stack>

      {plaxProtocolWarnings.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>PLAX protocol mismatch</AlertTitle>
          {plaxProtocolWarnings.map((warning) => (
            <Typography variant="body2" key={warning}>
              • {warning}
            </Typography>
          ))}
        </Alert>
      )}
      {canAcceptPlax && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => onAcceptMeasurements(unreviewedPlax.map(({ id }) => id))}
        >
          Accept reviewed PLAX inputs
        </Button>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">Fractional shortening</Typography>
            <Typography fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(linear.fractionalShorteningPercent, '%')}
            </Typography>
          </Box>
          {linear.lvidSource === 'tracked-cycle' && linear.phaseFrames && (
            <Typography variant="caption" color="text.secondary">
              Tracked beat: ED frame {linear.phaseFrames.ed + 1} · ES frame{' '}
              {linear.phaseFrames.es + 1} · LVEDD {format(linear.lveddMm, 'mm')} · LVESD{' '}
              {format(linear.lvesdMm, 'mm')}
            </Typography>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">LV mass</Typography>
            <Typography fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(linear.lvMassGrams, 'g', 0)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">Relative wall thickness</Typography>
            <Typography fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(linear.relativeWallThickness, '', 2)}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {linear.warnings.map((warning) => (
        <Alert key={warning} severity="warning" variant="outlined">
          {warning}
        </Alert>
      ))}

      <Divider />

      <Box>
        <Typography variant="h6">LVOT flow</Typography>
        <Typography variant="body2" color="text.secondary">
          Diameter is squared in the continuity calculation, so placement must match the PW sample
          level. VTI is entered from the calibrated Doppler trace because spatial image calibration
          cannot calibrate a time/velocity axis.
        </Typography>
      </Box>
      <MeasurementInput measurement={lvotDiameter} fallback="LVOT diameter" />
      {lvotDiameter && !lvotReviewed && assessMeasurementProtocol(lvotDiameter).compatible && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => onAcceptMeasurements([lvotDiameter.id])}
        >
          Accept reviewed LVOT diameter
        </Button>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          size="small"
          type="number"
          label="LVOT VTI"
          value={lvotVtiCm ?? ''}
          onChange={(event) =>
            onLvotVtiChange(event.target.value ? Number(event.target.value) : null)
          }
          InputProps={{ endAdornment: <Typography variant="caption">cm</Typography> }}
        />
        <TextField
          size="small"
          type="number"
          label="Heart rate"
          value={heartRateBpm ?? ''}
          onChange={(event) =>
            onHeartRateChange(event.target.value ? Number(event.target.value) : null)
          }
          InputProps={{ endAdornment: <Typography variant="caption">bpm</Typography> }}
        />
      </Stack>
      <FormControlLabel
        control={
          <Checkbox
            checked={vtiReviewed}
            disabled={lvotVtiCm === null}
            onChange={(event) => setReviewedVtiKey(event.target.checked ? vtiReviewKey : null)}
          />
        }
        label="I verified the PW Doppler envelope, sample position, and VTI trace"
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">LVOT area</Typography>
            <Typography>{format(lvot?.areaCm2 ?? null, 'cm²', 2)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">Stroke volume</Typography>
            <Typography>{format(lvot?.strokeVolumeMl ?? null, 'mL', 0)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography color="text.secondary">Cardiac output</Typography>
            <Typography>{format(lvot?.cardiacOutputLMin ?? null, 'L/min', 1)}</Typography>
          </Box>
          {bsa !== null && (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Stroke volume index</Typography>
                <Typography>{format(lvot?.strokeVolumeIndexMlM2 ?? null, 'mL/m²', 0)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Cardiac index</Typography>
                <Typography>{format(lvot?.cardiacIndexLMinM2 ?? null, 'L/min/m²', 1)}</Typography>
              </Box>
            </>
          )}
          <Chip
            size="small"
            color={lvotReportable ? 'success' : 'warning'}
            label={lvotReportable ? 'Reviewed' : 'Calculated · not reportable'}
          />
        </Stack>
      </Paper>
    </Stack>
  );
};

export default EchoQuantificationPanel;
