/**
 * Export Service
 *
 * Service for exporting measurements and annotations in various formats:
 * - DICOM Structured Report (SR)
 * - PDF with images and measurements
 * - JSON for data backup
 * - CSV for spreadsheet analysis
 */

import type {
  Measurement,
  SeriesInfo,
  StudyInfo,
  TrackingData,
} from '../types';
import { isLineMeasurement, isPolygonMeasurement } from '../types';

// ============================================================================
// Export Types
// ============================================================================

export type ExportFormat = 'dicom-sr' | 'dicom-files' | 'pdf' | 'json' | 'csv';

/** Options for export */
export interface ExportOptions {
  /** Include study/patient information */
  includePatientInfo: boolean;

  /** Include tracking graphs */
  includeTrackingGraphs: boolean;

  /** Include slice images with annotations */
  includeImages: boolean;

  /** Image format for embedded images */
  imageFormat: 'png' | 'jpeg';

  /** Image quality (0-100) */
  imageQuality: number;

  /** Author name for report */
  authorName?: string;

  /** Institution name */
  institutionName?: string;
}

/** Default export options */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includePatientInfo: true,
  includeTrackingGraphs: true,
  includeImages: true,
  imageFormat: 'png',
  imageQuality: 90,
};

/** DICOM SR content item types */
type SRContentType = 'CONTAINER' | 'TEXT' | 'NUM' | 'CODE' | 'DATETIME' | 'IMAGE' | 'SCOORD';

/** DICOM SR content item */
interface SRContentItem {
  relationshipType: 'CONTAINS' | 'HAS_OBS_CONTEXT' | 'HAS_ACQ_CONTEXT' | 'INFERRED_FROM';
  valueType: SRContentType;
  conceptNameCodeSequence?: {
    codeValue: string;
    codingSchemeDesignator: string;
    codeMeaning: string;
  };
  textValue?: string;
  numericValue?: number;
  unitCodeSequence?: {
    codeValue: string;
    codingSchemeDesignator: string;
    codeMeaning: string;
  };
  contentSequence?: SRContentItem[];
  graphicData?: number[];
  graphicType?: 'POINT' | 'MULTIPOINT' | 'POLYLINE' | 'POLYGON' | 'CIRCLE' | 'ELLIPSE';
}

// ============================================================================
// DICOM SR Generation
// ============================================================================

/**
 * Generate DICOM SR content items from measurements
 */
export function generateDicomSRContent(
  measurements: Measurement[],
  studyInfo: StudyInfo | null,
  seriesInfo: SeriesInfo | null
): SRContentItem {
  const rootContainer: SRContentItem = {
    relationshipType: 'CONTAINS',
    valueType: 'CONTAINER',
    conceptNameCodeSequence: {
      codeValue: '126000',
      codingSchemeDesignator: 'DCM',
      codeMeaning: 'Imaging Measurement Report',
    },
    contentSequence: [],
  };

  // Add study context
  if (studyInfo) {
    rootContainer.contentSequence!.push({
      relationshipType: 'HAS_OBS_CONTEXT',
      valueType: 'TEXT',
      conceptNameCodeSequence: {
        codeValue: '121060',
        codingSchemeDesignator: 'DCM',
        codeMeaning: 'Study Description',
      },
      textValue: studyInfo.studyDescription || 'Unknown Study',
    });
  }

  // Add series context
  if (seriesInfo) {
    rootContainer.contentSequence!.push({
      relationshipType: 'HAS_OBS_CONTEXT',
      valueType: 'TEXT',
      conceptNameCodeSequence: {
        codeValue: '121065',
        codingSchemeDesignator: 'DCM',
        codeMeaning: 'Series Description',
      },
      textValue: seriesInfo.seriesDescription || 'Unknown Series',
    });
  }

  // Add measurements
  const measurementGroup: SRContentItem = {
    relationshipType: 'CONTAINS',
    valueType: 'CONTAINER',
    conceptNameCodeSequence: {
      codeValue: '125007',
      codingSchemeDesignator: 'DCM',
      codeMeaning: 'Measurement Group',
    },
    contentSequence: [],
  };

  for (const measurement of measurements) {
    const measurementItem = createMeasurementSRItem(measurement);
    measurementGroup.contentSequence!.push(measurementItem);
  }

  rootContainer.contentSequence!.push(measurementGroup);

  return rootContainer;
}

/**
 * Create SR content item for a single measurement
 */
function createMeasurementSRItem(measurement: Measurement): SRContentItem {
  const item: SRContentItem = {
    relationshipType: 'CONTAINS',
    valueType: 'CONTAINER',
    conceptNameCodeSequence: {
      codeValue: getMeasurementTypeCode(measurement.type),
      codingSchemeDesignator: 'DCM',
      codeMeaning: getMeasurementTypeName(measurement.type),
    },
    contentSequence: [],
  };

  // Add label if present
  if (measurement.label) {
    item.contentSequence!.push({
      relationshipType: 'CONTAINS',
      valueType: 'TEXT',
      conceptNameCodeSequence: {
        codeValue: '112039',
        codingSchemeDesignator: 'DCM',
        codeMeaning: 'Label',
      },
      textValue: measurement.label,
    });
  }

  // Add measurement values
  if (isLineMeasurement(measurement) && measurement.lengthMm !== null) {
    item.contentSequence!.push({
      relationshipType: 'CONTAINS',
      valueType: 'NUM',
      conceptNameCodeSequence: {
        codeValue: '410668003',
        codingSchemeDesignator: 'SCT',
        codeMeaning: 'Length',
      },
      numericValue: measurement.lengthMm,
      unitCodeSequence: {
        codeValue: 'mm',
        codingSchemeDesignator: 'UCUM',
        codeMeaning: 'millimeter',
      },
    });

    // Add coordinate data
    item.contentSequence!.push({
      relationshipType: 'INFERRED_FROM',
      valueType: 'SCOORD',
      graphicType: 'POLYLINE',
      graphicData: [
        measurement.points[0].x, measurement.points[0].y,
        measurement.points[1].x, measurement.points[1].y,
      ],
    });
  }

  if (isPolygonMeasurement(measurement)) {
    if (measurement.areaMm2 !== null) {
      item.contentSequence!.push({
        relationshipType: 'CONTAINS',
        valueType: 'NUM',
        conceptNameCodeSequence: {
          codeValue: '42798000',
          codingSchemeDesignator: 'SCT',
          codeMeaning: 'Area',
        },
        numericValue: measurement.areaMm2,
        unitCodeSequence: {
          codeValue: 'mm2',
          codingSchemeDesignator: 'UCUM',
          codeMeaning: 'square millimeter',
        },
      });
    }

    if (measurement.perimeterMm !== null) {
      item.contentSequence!.push({
        relationshipType: 'CONTAINS',
        valueType: 'NUM',
        conceptNameCodeSequence: {
          codeValue: '131191004',
          codingSchemeDesignator: 'SCT',
          codeMeaning: 'Perimeter',
        },
        numericValue: measurement.perimeterMm,
        unitCodeSequence: {
          codeValue: 'mm',
          codingSchemeDesignator: 'UCUM',
          codeMeaning: 'millimeter',
        },
      });
    }

    // Add coordinate data
    const graphicData: number[] = [];
    for (const point of measurement.points) {
      graphicData.push(point.x, point.y);
    }
    // Close the polygon
    if (measurement.points.length > 0) {
      graphicData.push(measurement.points[0].x, measurement.points[0].y);
    }

    item.contentSequence!.push({
      relationshipType: 'INFERRED_FROM',
      valueType: 'SCOORD',
      graphicType: 'POLYGON',
      graphicData,
    });
  }

  return item;
}

/**
 * Get DICOM code for measurement type
 */
function getMeasurementTypeCode(type: Measurement['type']): string {
  switch (type) {
    case 'line':
      return '410668003'; // Length measurement
    case 'polygon':
      return '42798000'; // Area measurement
    case 'polyline':
      return '410668003'; // Path length
    case 'freehand':
      return '42798000'; // Freehand area
    case 'ellipse':
      return '42798000'; // Ellipse area
    case 'rectangle':
      return '42798000'; // Rectangle area
    default:
      return '363787002'; // Observable entity
  }
}

/**
 * Get human-readable name for measurement type
 */
function getMeasurementTypeName(type: Measurement['type']): string {
  switch (type) {
    case 'line':
      return 'Linear Measurement';
    case 'polygon':
      return 'Polygon Area Measurement';
    case 'polyline':
      return 'Path Length Measurement';
    case 'freehand':
      return 'Freehand Region Measurement';
    case 'ellipse':
      return 'Ellipse Area Measurement';
    case 'rectangle':
      return 'Rectangle Area Measurement';
    default:
      return 'Measurement';
  }
}

// ============================================================================
// PDF Generation
// ============================================================================

/** PDF report data structure */
export interface PDFReportData {
  title: string;
  generatedAt: Date;
  author?: string;
  institution?: string;
  patient?: {
    id: string;
    name: string;
    birthDate?: string;
    sex?: string;
  };
  study?: {
    uid: string;
    date: string;
    description: string;
    modality: string;
  };
  measurements: PDFMeasurementEntry[];
  trackingCharts?: PDFTrackingChart[];
  images?: PDFImageEntry[];
}

/** Single measurement entry for PDF */
export interface PDFMeasurementEntry {
  id: string;
  type: string;
  label: string;
  values: { name: string; value: string; unit: string }[];
  frameInfo: string;
  createdAt: string;
}

/** Tracking chart data for PDF */
export interface PDFTrackingChart {
  measurementId: string;
  label: string;
  data: { frame: number; value: number }[];
  unit: string;
  summary: {
    min: string;
    max: string;
    mean: string;
    change: string;
  };
}

/** Image entry for PDF */
export interface PDFImageEntry {
  dataUrl: string;
  caption: string;
  frameInfo: string;
}

/**
 * Generate PDF report data from measurements
 */
export function generatePDFReportData(
  measurements: Measurement[],
  studyInfo: StudyInfo | null,
  seriesInfo: SeriesInfo | null,
  trackingData: Map<string, TrackingData>,
  options: ExportOptions
): PDFReportData {
  const report: PDFReportData = {
    title: 'DICOM Measurement Report',
    generatedAt: new Date(),
    author: options.authorName,
    institution: options.institutionName,
    measurements: [],
  };

  // Add patient/study info
  if (options.includePatientInfo && studyInfo) {
    report.patient = {
      id: studyInfo.patientId || 'Unknown',
      name: studyInfo.patientName || 'Unknown',
      birthDate: undefined, // Not available in StudyInfo
      sex: undefined, // Not available in StudyInfo
    };

    report.study = {
      uid: studyInfo.studyInstanceUid,
      date: studyInfo.studyDate || 'Unknown',
      description: studyInfo.studyDescription || 'Unknown',
      modality: seriesInfo?.modality || 'Unknown',
    };
  }

  // Add measurements
  for (const measurement of measurements) {
    const entry: PDFMeasurementEntry = {
      id: measurement.id,
      type: getMeasurementTypeName(measurement.type),
      label: measurement.label || `${getMeasurementTypeName(measurement.type)} ${measurements.indexOf(measurement) + 1}`,
      values: [],
      frameInfo: measurement.frameKey || 'Unknown Frame',
      createdAt: new Date(measurement.createdAt).toLocaleString(),
    };

    // Add measurement values
    if (isLineMeasurement(measurement) && measurement.lengthMm !== null) {
      entry.values.push({
        name: 'Length',
        value: measurement.lengthMm.toFixed(2),
        unit: 'mm',
      });
    }

    if (isPolygonMeasurement(measurement)) {
      if (measurement.areaMm2 !== null) {
        entry.values.push({
          name: 'Area',
          value: measurement.areaMm2.toFixed(2),
          unit: 'mm^2',
        });
      }
      if (measurement.perimeterMm !== null) {
        entry.values.push({
          name: 'Perimeter',
          value: measurement.perimeterMm.toFixed(2),
          unit: 'mm',
        });
      }
    }

    report.measurements.push(entry);
  }

  // Add tracking charts
  if (options.includeTrackingGraphs) {
    report.trackingCharts = [];

    for (const [measurementId, tracking] of trackingData) {
      const measurement = measurements.find((m) => m.id === measurementId);
      if (!measurement) continue;

      const chartData: PDFTrackingChart = {
        measurementId,
        label: measurement.label || `Measurement ${measurementId.slice(0, 8)}`,
        data: tracking.frames.map((frame, index) => ({
          frame: index,
          value: frame.lengthMm ?? frame.areaMm2 ?? 0,
        })),
        unit: isLineMeasurement(measurement) ? 'mm' : 'mm^2',
        summary: {
          min: tracking.summary.minMm?.toFixed(2) ?? 'N/A',
          max: tracking.summary.maxMm?.toFixed(2) ?? 'N/A',
          mean: tracking.summary.meanMm?.toFixed(2) ?? 'N/A',
          change: 'N/A',
        },
      };

      report.trackingCharts.push(chartData);
    }
  }

  return report;
}

/**
 * Generate HTML for PDF export (can be converted to PDF using browser print)
 */
export function generatePDFHTML(data: PDFReportData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(data.title)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      color: #333;
    }
    h1 {
      color: #1976d2;
      border-bottom: 2px solid #1976d2;
      padding-bottom: 10px;
    }
    h2 {
      color: #555;
      margin-top: 30px;
    }
    .header-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
      padding: 15px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    .info-group {
      margin-bottom: 10px;
    }
    .info-label {
      font-weight: bold;
      color: #666;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
    }
    th {
      background: #f0f0f0;
      font-weight: bold;
    }
    tr:nth-child(even) {
      background: #f9f9f9;
    }
    .measurement-values {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .measurement-values li {
      margin: 5px 0;
    }
    .tracking-summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 10px;
      padding: 10px;
      background: #e3f2fd;
      border-radius: 4px;
    }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #666;
    }
    @media print {
      body { margin: 20px; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>

  <div class="header-info">
    <div>
      ${data.patient ? `
        <div class="info-group">
          <span class="info-label">Patient:</span> ${escapeHtml(data.patient.name)}
        </div>
        <div class="info-group">
          <span class="info-label">Patient ID:</span> ${escapeHtml(data.patient.id)}
        </div>
        ${data.patient.birthDate ? `
          <div class="info-group">
            <span class="info-label">Birth Date:</span> ${escapeHtml(data.patient.birthDate)}
          </div>
        ` : ''}
      ` : ''}
    </div>
    <div>
      ${data.study ? `
        <div class="info-group">
          <span class="info-label">Study Date:</span> ${escapeHtml(data.study.date)}
        </div>
        <div class="info-group">
          <span class="info-label">Modality:</span> ${escapeHtml(data.study.modality)}
        </div>
        <div class="info-group">
          <span class="info-label">Description:</span> ${escapeHtml(data.study.description)}
        </div>
      ` : ''}
    </div>
  </div>

  <h2>Measurements (${data.measurements.length})</h2>

  <table>
    <thead>
      <tr>
        <th>Label</th>
        <th>Type</th>
        <th>Values</th>
        <th>Frame</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>
      ${data.measurements.map((m) => `
        <tr>
          <td>${escapeHtml(m.label)}</td>
          <td>${escapeHtml(m.type)}</td>
          <td>
            <ul class="measurement-values">
              ${m.values.map((v) => `
                <li><strong>${escapeHtml(v.name)}:</strong> ${escapeHtml(v.value)} ${escapeHtml(v.unit)}</li>
              `).join('')}
            </ul>
          </td>
          <td>${escapeHtml(m.frameInfo)}</td>
          <td>${escapeHtml(m.createdAt)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${data.trackingCharts && data.trackingCharts.length > 0 ? `
    <h2 class="page-break">Tracking Results</h2>
    ${data.trackingCharts.map((chart) => `
      <h3>${escapeHtml(chart.label)}</h3>
      <div class="tracking-summary">
        <div><strong>Min:</strong> ${escapeHtml(chart.summary.min)} ${escapeHtml(chart.unit)}</div>
        <div><strong>Max:</strong> ${escapeHtml(chart.summary.max)} ${escapeHtml(chart.unit)}</div>
        <div><strong>Mean:</strong> ${escapeHtml(chart.summary.mean)} ${escapeHtml(chart.unit)}</div>
        <div><strong>Change:</strong> ${escapeHtml(chart.summary.change)}</div>
      </div>
    `).join('')}
  ` : ''}

  <div class="footer">
    <p>Generated: ${data.generatedAt.toLocaleString()}</p>
    ${data.author ? `<p>Author: ${escapeHtml(data.author)}</p>` : ''}
    ${data.institution ? `<p>Institution: ${escapeHtml(data.institution)}</p>` : ''}
    <p>This report was generated by Horalix DICOM Viewer</p>
  </div>
</body>
</html>
  `;
}

/**
 * Helper to escape HTML entities
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// JSON Export
// ============================================================================

/** JSON export structure */
export interface JSONExportData {
  version: string;
  exportedAt: string;
  study?: {
    uid: string;
    date: string;
    description: string;
    patientId: string;
    patientName: string;
  };
  series?: {
    uid: string;
    number: number | null;
    modality: string;
    description: string;
  };
  measurements: Measurement[];
  trackingData: Array<{ measurementId: string; data: TrackingData }>;
}

/**
 * Generate JSON export data
 */
export function generateJSONExport(
  measurements: Measurement[],
  studyInfo: StudyInfo | null,
  seriesInfo: SeriesInfo | null,
  trackingData: Map<string, TrackingData>
): JSONExportData {
  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    study: studyInfo ? {
      uid: studyInfo.studyInstanceUid,
      date: studyInfo.studyDate || '',
      description: studyInfo.studyDescription || '',
      patientId: studyInfo.patientId || '',
      patientName: studyInfo.patientName || '',
    } : undefined,
    series: seriesInfo ? {
      uid: seriesInfo.seriesInstanceUid,
      number: seriesInfo.seriesNumber,
      modality: seriesInfo.modality,
      description: seriesInfo.seriesDescription || '',
    } : undefined,
    measurements,
    trackingData: Array.from(trackingData.entries()).map(([measurementId, data]) => ({
      measurementId,
      data,
    })),
  };
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Generate CSV export for measurements
 */
export function generateCSVExport(measurements: Measurement[]): string {
  const headers = [
    'ID',
    'Type',
    'Label',
    'Series UID',
    'Frame Key',
    'Scope',
    'Length (mm)',
    'Area (mm^2)',
    'Perimeter (mm)',
    'Created',
    'Modified',
  ];

  const rows = measurements.map((m) => {
    const lengthMm = isLineMeasurement(m) ? m.lengthMm?.toFixed(2) ?? '' : '';
    const areaMm2 = isPolygonMeasurement(m) ? m.areaMm2?.toFixed(2) ?? '' : '';
    const perimeterMm = isPolygonMeasurement(m) ? m.perimeterMm?.toFixed(2) ?? '' : '';

    return [
      m.id,
      m.type,
      m.label || '',
      m.seriesUid,
      m.frameKey || '',
      m.scope,
      lengthMm,
      areaMm2,
      perimeterMm,
      new Date(m.createdAt).toISOString(),
      new Date(m.modifiedAt).toISOString(),
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * Escape CSV field value
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ============================================================================
// Download Helpers
// ============================================================================

/**
 * Trigger file download
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export measurements to specified format
 */
export async function exportMeasurements(
  format: ExportFormat,
  measurements: Measurement[],
  studyInfo: StudyInfo | null,
  seriesInfo: SeriesInfo | null,
  trackingData: Map<string, TrackingData>,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const studyId = studyInfo?.studyInstanceUid.slice(-8) || 'unknown';

  switch (format) {
    case 'dicom-sr': {
      const srContent = generateDicomSRContent(measurements, studyInfo, seriesInfo);
      const jsonContent = JSON.stringify(srContent, null, 2);
      downloadFile(jsonContent, `measurements_${studyId}_${timestamp}.dcm.json`, 'application/json');
      break;
    }

    case 'pdf': {
      const reportData = generatePDFReportData(measurements, studyInfo, seriesInfo, trackingData, options);
      const html = generatePDFHTML(reportData);

      // Open in new window for printing
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
      }
      break;
    }

    case 'json': {
      const jsonData = generateJSONExport(measurements, studyInfo, seriesInfo, trackingData);
      const jsonContent = JSON.stringify(jsonData, null, 2);
      downloadFile(jsonContent, `measurements_${studyId}_${timestamp}.json`, 'application/json');
      break;
    }

    case 'csv': {
      const csvContent = generateCSVExport(measurements);
      downloadFile(csvContent, `measurements_${studyId}_${timestamp}.csv`, 'text/csv');
      break;
    }
  }
}
