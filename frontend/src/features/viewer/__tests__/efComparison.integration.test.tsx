import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AIResultsPanel } from '../components/AIResultsPanel';
import efFixture from './fixtures/ai/ef-comparison.json';

describe('AIResultsPanel EF comparison', () => {
  it('prioritizes fused EF and still surfaces Teichholz + EchoNet', () => {
    render(
      <AIResultsPanel
        cardiacResults={[]}
        latestCardiacJob={{
          job_id: 'job-1',
          model_type: 'horalix_ai',
          task_type: 'cardiac',
          completed_at: '2026-02-05T17:00:00Z',
          inference_time_ms: 4200,
          results: { output: efFixture },
          result_files: null,
        }}
        showOverlay
        onToggleOverlay={() => {}}
        showMeasurementOverlay
        onToggleMeasurementOverlay={() => {}}
        showContourOverlay
        onToggleContourOverlay={() => {}}
        lineOverlayCount={0}
        contourOverlayCount={0}
        isRunning={false}
      />
    );

    expect(screen.getByText(/Ejection Fraction \(EF\)/i)).toBeTruthy();
    expect(screen.getAllByText(/58/).length).toBeGreaterThan(0);
    expect(screen.getByText(/LVEF Teichholz/i)).toBeTruthy();
    expect(screen.getAllByText(/52.0/).length).toBeGreaterThan(0);
    expect(screen.getByText(/LV Volume Curve/i)).toBeTruthy();
    expect(screen.getByText(/EF:/i)).toBeTruthy();
  });
});
