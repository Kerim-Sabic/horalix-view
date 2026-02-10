type MeasurementOption = {
  value: string;
  label: string;
};

export const HORALIX_MEASUREMENT_OPTIONS: MeasurementOption[] = [
  { value: 'lvid', label: 'LVID (LV internal diameter)' },
  { value: 'ivs', label: 'IVS thickness' },
  { value: 'lvpw', label: 'LVPW thickness' },
  { value: 'aorta', label: 'Aorta diameter' },
  { value: 'aortic_root', label: 'Aortic root diameter' },
  { value: 'la', label: 'Left atrium diameter' },
  { value: 'rv_base', label: 'RV base diameter' },
  { value: 'pa', label: 'Pulmonary artery diameter' },
  { value: 'ivc', label: 'IVC diameter' },
];
