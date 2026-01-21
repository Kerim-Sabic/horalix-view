/**
 * Centralized API Service for Horalix View
 *
 * Provides typed API calls to all backend endpoints.
 */

import { apiClient } from './apiClient';

// ============================================================================
// Types
// ============================================================================

export interface Study {
  study_instance_uid: string;
  patient_name: string;
  patient_id: string;
  study_date: string | null;
  study_time: string | null;
  study_description: string | null;
  accession_number: string | null;
  modalities: string[];
  num_series: number;
  num_instances: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  referring_physician: string | null;
  institution_name: string | null;
  created_at: string;
}

export interface StudyListResponse {
  total: number;
  page: number;
  page_size: number;
  studies: Study[];
}

export interface StudySearchParams {
  patient_name?: string;
  patient_id?: string;
  study_date_from?: string;
  study_date_to?: string;
  modality?: string;
  accession_number?: string;
  page?: number;
  page_size?: number;
}

export interface Series {
  series_instance_uid: string;
  study_instance_uid: string;
  series_number: number | null;
  series_description: string | null;
  modality: string;
  series_date: string | null;
  series_time: string | null;
  body_part_examined: string | null;
  patient_position: string | null;
  protocol_name: string | null;
  num_instances: number;
  slice_thickness: number | null;
  spacing_between_slices: number | null;
}

export interface SeriesListResponse {
  total: number;
  series: Series[];
}

export interface Instance {
  sop_instance_uid: string;
  instance_number: number | null;
  sop_class_uid: string;
  rows: number | null;
  columns: number | null;
  bits_allocated: number | null;
}

export interface SeriesDetailResponse {
  series: Series;
  instances: Instance[];
  window_center: number | null;
  window_width: number | null;
  has_3d_data: boolean;
}

export interface VolumeInfo {
  series_uid: string;
  dimensions: { x: number; y: number; z: number };
  spacing: { x: number; y: number; z: number };
  origin: { x: number; y: number; z: number };
  orientation: number[];
  modality: string;
  supports_mpr: boolean;
  supports_vr: boolean;
}

export interface FrameInfo {
  series_uid: string;
  total_frames: number;
  start: number;
  count: number;
  frames: Array<{
    index: number;
    instance_uid: string;
    position: number;
    slice_location: number | null;
  }>;
}

export interface Patient {
  patient_id: string;
  patient_name: string;
  patient_birth_date: string | null;
  patient_sex: string | null;
  other_patient_ids: string | null;
  ethnic_group: string | null;
  patient_comments: string | null;
  num_studies: number;
  created_at: string;
}

export interface PatientListResponse {
  total: number;
  page: number;
  page_size: number;
  patients: Patient[];
}

export interface AIJob {
  job_id: string;
  model_type: string;
  task_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  study_instance_uid: string;
  series_instance_uid: string | null;
  input_params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AIJobListResponse {
  total: number;
  page: number;
  page_size: number;
  jobs: AIJob[];
}

export interface AIJobCreateParams {
  model_type: string;
  task_type: string;
  study_instance_uid: string;
  series_instance_uid?: string;
  input_params?: Record<string, unknown>;
}

export interface AIModel {
  model_id: string;
  name: string;
  description: string;
  model_type: string;
  supported_modalities: string[];
  is_loaded: boolean;
  memory_usage_mb: number;
  metrics: Record<string, number>;
}

export interface AIModelsResponse {
  models: AIModel[];
}

export interface DashboardStats {
  total_studies: number;
  total_patients: number;
  total_series: number;
  total_instances: number;
  ai_jobs_today: number;
  ai_jobs_running: number;
  storage_used_bytes: number;
  storage_total_bytes: number;
}

export interface DicomTag {
  tag: string;
  name: string;
  vr: string;
  value: string | number | string[] | null;
}

export interface UploadProgress {
  file_name: string;
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

// ============================================================================
// API Service
// ============================================================================

export const api = {
  // --------------------------------------------------------------------------
  // Studies
  // --------------------------------------------------------------------------
  studies: {
    /**
     * List studies with optional search/filter parameters.
     */
    async list(params?: StudySearchParams): Promise<StudyListResponse> {
      const response = await apiClient.get<StudyListResponse>('/studies', { params });
      return response.data;
    },

    /**
     * Get a single study by UID.
     */
    async get(studyUid: string): Promise<Study> {
      const response = await apiClient.get<Study>(`/studies/${studyUid}`);
      return response.data;
    },

    /**
     * Upload DICOM files to create/update studies.
     */
    async upload(
      files: File[],
      onProgress?: (progress: UploadProgress[]) => void
    ): Promise<{ studies_created: string[]; instances_stored: number }> {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await apiClient.post('/studies/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(
              files.map((f) => ({
                file_name: f.name,
                progress,
                status: progress < 100 ? 'uploading' : 'processing',
              }))
            );
          }
        },
      });

      return response.data;
    },

    /**
     * Delete a study.
     */
    async delete(studyUid: string): Promise<void> {
      await apiClient.delete(`/studies/${studyUid}`);
    },

    /**
     * Export study to specified format.
     */
    async export(studyUid: string, format: 'dicom' | 'nifti' | 'png'): Promise<Blob> {
      const response = await apiClient.get(`/studies/${studyUid}/export`, {
        params: { format },
        responseType: 'blob',
      });
      return response.data;
    },
  },

  // --------------------------------------------------------------------------
  // Series
  // --------------------------------------------------------------------------
  series: {
    /**
     * List series with optional study filter.
     */
    async list(studyUid?: string, modality?: string): Promise<SeriesListResponse> {
      const response = await apiClient.get<SeriesListResponse>('/series', {
        params: { study_uid: studyUid, modality },
      });
      return response.data;
    },

    /**
     * Get detailed series information with instances.
     */
    async get(seriesUid: string): Promise<SeriesDetailResponse> {
      const response = await apiClient.get<SeriesDetailResponse>(`/series/${seriesUid}`);
      return response.data;
    },

    /**
     * Get frame information for cine/scroll navigation.
     */
    async getFrames(seriesUid: string, start?: number, count?: number): Promise<FrameInfo> {
      const response = await apiClient.get<FrameInfo>(`/series/${seriesUid}/frames`, {
        params: { start, count },
      });
      return response.data;
    },

    /**
     * Get 3D volume information for MPR/VR.
     */
    async getVolumeInfo(seriesUid: string): Promise<VolumeInfo> {
      const response = await apiClient.get<VolumeInfo>(`/series/${seriesUid}/volume-info`);
      return response.data;
    },
  },

  // --------------------------------------------------------------------------
  // Instances
  // --------------------------------------------------------------------------
  instances: {
    /**
     * Get instance metadata.
     */
    async get(instanceUid: string): Promise<Instance> {
      const response = await apiClient.get<Instance>(`/instances/${instanceUid}`);
      return response.data;
    },

    /**
     * Get DICOM tags for an instance.
     */
    async getTags(instanceUid: string): Promise<DicomTag[]> {
      const response = await apiClient.get<DicomTag[]>(`/instances/${instanceUid}/tags`);
      return response.data;
    },

    /**
     * Get pixel data as rendered image.
     */
    getPixelDataUrl(
      instanceUid: string,
      options?: {
        frame?: number;
        windowCenter?: number;
        windowWidth?: number;
        format?: 'png' | 'jpeg';
        quality?: number;
      }
    ): string {
      const params = new URLSearchParams();
      if (options?.frame !== undefined) params.set('frame', options.frame.toString());
      if (options?.windowCenter !== undefined) params.set('window_center', options.windowCenter.toString());
      if (options?.windowWidth !== undefined) params.set('window_width', options.windowWidth.toString());
      if (options?.format) params.set('format', options.format);
      if (options?.quality !== undefined) params.set('quality', options.quality.toString());

      const queryString = params.toString();
      return `/api/v1/instances/${instanceUid}/pixel-data${queryString ? `?${queryString}` : ''}`;
    },

    /**
     * Get raw pixel data as ArrayBuffer.
     */
    async getPixelData(instanceUid: string, frame?: number): Promise<ArrayBuffer> {
      const response = await apiClient.get(`/instances/${instanceUid}/pixel-data`, {
        params: { frame, format: 'raw' },
        responseType: 'arraybuffer',
      });
      return response.data;
    },
  },

  // --------------------------------------------------------------------------
  // Patients
  // --------------------------------------------------------------------------
  patients: {
    /**
     * List patients with pagination.
     */
    async list(params?: { page?: number; page_size?: number; search?: string }): Promise<PatientListResponse> {
      const response = await apiClient.get<PatientListResponse>('/patients', { params });
      return response.data;
    },

    /**
     * Get patient by ID.
     */
    async get(patientId: string): Promise<Patient> {
      const response = await apiClient.get<Patient>(`/patients/${patientId}`);
      return response.data;
    },

    /**
     * Get all studies for a patient.
     */
    async getStudies(patientId: string): Promise<StudyListResponse> {
      const response = await apiClient.get<StudyListResponse>(`/patients/${patientId}/studies`);
      return response.data;
    },
  },

  // --------------------------------------------------------------------------
  // AI Jobs
  // --------------------------------------------------------------------------
  ai: {
    /**
     * List AI models.
     */
    async getModels(): Promise<AIModelsResponse> {
      const response = await apiClient.get<AIModelsResponse>('/ai/models');
      return response.data;
    },

    /**
     * Load an AI model.
     */
    async loadModel(modelId: string): Promise<void> {
      await apiClient.post(`/ai/models/${modelId}/load`);
    },

    /**
     * Unload an AI model.
     */
    async unloadModel(modelId: string): Promise<void> {
      await apiClient.post(`/ai/models/${modelId}/unload`);
    },

    /**
     * Create a new AI inference job.
     */
    async createJob(params: AIJobCreateParams): Promise<AIJob> {
      const response = await apiClient.post<AIJob>('/ai/jobs', params);
      return response.data;
    },

    /**
     * List AI jobs with filters.
     */
    async listJobs(params?: {
      status?: string;
      model_type?: string;
      study_uid?: string;
      page?: number;
      page_size?: number;
    }): Promise<AIJobListResponse> {
      const response = await apiClient.get<AIJobListResponse>('/ai/jobs', { params });
      return response.data;
    },

    /**
     * Get job status and results.
     */
    async getJob(jobId: string): Promise<AIJob> {
      const response = await apiClient.get<AIJob>(`/ai/jobs/${jobId}`);
      return response.data;
    },

    /**
     * Cancel a running job.
     */
    async cancelJob(jobId: string): Promise<void> {
      await apiClient.post(`/ai/jobs/${jobId}/cancel`);
    },

    /**
     * Poll job status until completion.
     */
    async waitForJob(jobId: string, intervalMs = 1000, timeoutMs = 300000): Promise<AIJob> {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const job = await this.getJob(jobId);
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
    },
  },

  // --------------------------------------------------------------------------
  // Dashboard
  // --------------------------------------------------------------------------
  dashboard: {
    /**
     * Get dashboard statistics.
     * Returns safe defaults if the API returns invalid data.
     */
    async getStats(): Promise<DashboardStats> {
      const defaultStats: DashboardStats = {
        total_studies: 0,
        total_patients: 0,
        total_series: 0,
        total_instances: 0,
        ai_jobs_today: 0,
        ai_jobs_running: 0,
        storage_used_bytes: 0,
        storage_total_bytes: 1, // Avoid division by zero
      };

      try {
        const response = await apiClient.get<DashboardStats>('/dashboard/stats');
        const data = response.data;

        // Validate and merge with defaults to ensure all fields exist
        if (data && typeof data === 'object') {
          return {
            total_studies: typeof data.total_studies === 'number' ? data.total_studies : defaultStats.total_studies,
            total_patients: typeof data.total_patients === 'number' ? data.total_patients : defaultStats.total_patients,
            total_series: typeof data.total_series === 'number' ? data.total_series : defaultStats.total_series,
            total_instances: typeof data.total_instances === 'number' ? data.total_instances : defaultStats.total_instances,
            ai_jobs_today: typeof data.ai_jobs_today === 'number' ? data.ai_jobs_today : defaultStats.ai_jobs_today,
            ai_jobs_running: typeof data.ai_jobs_running === 'number' ? data.ai_jobs_running : defaultStats.ai_jobs_running,
            storage_used_bytes: typeof data.storage_used_bytes === 'number' ? data.storage_used_bytes : defaultStats.storage_used_bytes,
            storage_total_bytes: typeof data.storage_total_bytes === 'number' && data.storage_total_bytes > 0
              ? data.storage_total_bytes
              : defaultStats.storage_total_bytes,
          };
        }

        return defaultStats;
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
        throw error; // Let caller handle error - don't silently return defaults
      }
    },

    /**
     * Get recent studies for dashboard.
     * Always returns an array, never undefined.
     */
    async getRecentStudies(limit = 5): Promise<Study[]> {
      try {
        const response = await apiClient.get<StudyListResponse>('/studies', {
          params: { page: 1, page_size: limit },
        });

        // Ensure we always return an array
        const studies = response.data?.studies;
        return Array.isArray(studies) ? studies : [];
      } catch (error) {
        console.error('Failed to fetch recent studies:', error);
        throw error; // Let caller handle error - don't silently return empty array
      }
    },

    /**
     * Get recent AI jobs for dashboard.
     * Always returns an array, never undefined.
     */
    async getRecentJobs(limit = 5): Promise<AIJob[]> {
      try {
        const response = await apiClient.get<AIJobListResponse>('/ai/jobs', {
          params: { page: 1, page_size: limit },
        });

        // Ensure we always return an array
        const jobs = response.data?.jobs;
        return Array.isArray(jobs) ? jobs : [];
      } catch (error) {
        console.error('Failed to fetch recent jobs:', error);
        throw error; // Let caller handle error - don't silently return empty array
      }
    },
  },

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------
  health: {
    /**
     * Check API health.
     */
    async check(): Promise<{ status: string; version: string }> {
      const response = await apiClient.get('/health');
      return response.data;
    },

    /**
     * Check API readiness.
     */
    async ready(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
      const response = await apiClient.get('/ready');
      return response.data;
    },
  },
};

export default api;
