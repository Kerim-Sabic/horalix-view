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
  study_id: string | null;
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

type StudyPayload = Omit<Study, 'modalities' | 'referring_physician'> & {
  modalities?: unknown;
  modalities_in_study?: unknown;
  referring_physician?: unknown;
  referring_physician_name?: unknown;
};

const normalizeStudy = (study: StudyPayload): Study => {
  const modalitiesSource = Array.isArray(study.modalities)
    ? study.modalities
    : Array.isArray(study.modalities_in_study)
      ? study.modalities_in_study
      : [];
  const modalities = modalitiesSource.filter((mod): mod is string => typeof mod === 'string');
  const referringPhysician =
    typeof study.referring_physician === 'string'
      ? study.referring_physician
      : typeof study.referring_physician_name === 'string'
        ? study.referring_physician_name
        : null;

  return {
    ...study,
    study_id: typeof study.study_id === 'string' ? study.study_id : null,
    patient_name: typeof study.patient_name === 'string' ? study.patient_name : '',
    patient_id: typeof study.patient_id === 'string' ? study.patient_id : '',
    modalities,
    referring_physician: referringPhysician,
  };
};

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

export interface StudyUpdateRequest {
  study_id?: string | null;
  study_date?: string | null;
  study_time?: string | null;
  study_description?: string | null;
  accession_number?: string | null;
  referring_physician_name?: string | null;
  institution_name?: string | null;
  modalities_in_study?: string[] | null;
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

export interface SeriesUpdateRequest {
  series_number?: number | null;
  series_description?: string | null;
  body_part_examined?: string | null;
  patient_position?: string | null;
  protocol_name?: string | null;
  slice_thickness?: number | null;
  spacing_between_slices?: number | null;
  window_center?: number | null;
  window_width?: number | null;
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
  bits_stored?: number | null;
  photometric_interpretation?: string | null;
  pixel_spacing?: [number, number] | null;
  window_center?: number | null;
  window_width?: number | null;
  rescale_intercept?: number | null;
  rescale_slope?: number | null;
  number_of_frames?: number | null;
  image_position_patient?: [number, number, number] | null;
  image_orientation_patient?: [number, number, number, number, number, number] | null;
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

export interface TrackMeasurementRequest {
  start_index: number;
  max_frames?: number;
  track_full_loop?: boolean;
  points: Array<{ x: number; y: number }>;
}

export interface TrackMeasurementResponse {
  series_uid: string;
  total_frames: number;
  frames: Array<{
    frame_index: number;
    points: Array<{ x: number; y: number }>;
    length_mm: number | null;
    area_mm2: number | null;
    valid: boolean;
  }>;
  summary: {
    min_mm: number | null;
    max_mm: number | null;
    mean_mm: number | null;
    min_area_mm2: number | null;
    max_area_mm2: number | null;
    mean_area_mm2: number | null;
  };
}

export interface AdminSystemStatus {
  status: string;
  version: string;
  uptime_seconds: number;
  cpu_usage_percent: number;
  memory_usage_percent: number;
  disk_usage_percent: number;
  active_users: number;
  pending_jobs: number;
}

export interface AdminStorageInfo {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  study_count: number;
  series_count: number;
  instance_count: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  roles: string[];
  is_active: boolean;
}

export interface Patient {
  patient_id: string;
  patient_name: string;
  birth_date: string | null;
  sex: string | null;
  issuer_of_patient_id: string | null;
  other_patient_ids: string | null;
  ethnic_group: string | null;
  comments: string | null;
  study_count: number;
  last_study_date: string | null;
}

export interface PatientUpdateRequest {
  patient_id?: string | null;
  patient_name?: string | null;
  birth_date?: string | null;
  sex?: string | null;
  issuer_of_patient_id?: string | null;
  other_patient_ids?: string | null;
  ethnic_group?: string | null;
  comments?: string | null;
}

export interface PatientListResponse {
  total: number;
  page: number;
  page_size: number;
  patients: Patient[];
}

export interface AIJob {
  job_id: string;
  study_uid: string;
  series_uid: string | null;
  model_type: string;
  task_type: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  results: Record<string, unknown> | null;
  result_files: Record<string, string> | null;
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
  study_uid: string;
  series_uid?: string | null;
  parameters?: Record<string, unknown>;
  priority?: number;
}

export interface AIModelDetails {
  model_type: string;
  version: string;
  description: string;
  supported_modalities: string[];
  performance_metrics: Record<string, number>;
  reference?: string | null;
  license?: string | null;
  class_names?: string[];
  input_size?: number[];
  output_channels?: number | null;
}

export interface AIModelRequirements {
  enabled: boolean;
  device?: string | null;
  weights_path?: string | null;
}

export interface AIModelWeights {
  path?: string | null;
  exists: boolean;
  size_bytes?: number | null;
  sha256?: string | null;
}

export interface AIModel {
  name: string;
  available: boolean;
  status: string;
  details: AIModelDetails;
  requirements: AIModelRequirements;
  weights: AIModelWeights;
  last_checked: string | null;
  errors: string[];
}

export interface AIModelsResponse {
  models: AIModel[];
  total_registered?: number;
  total_available?: number;
  message?: string;
  shape_error?: string | null;
}

export interface InteractiveSegmentationResponse {
  instance_uid: string;
  mask_shape: number[];
  mask_url: string;
  confidence: number;
  inference_time_ms: number;
  model_name: string;
  model_version: string;
  contours: Array<Array<{ x: number; y: number }>>;
  primary_contour: Array<{ x: number; y: number }>;
  mask_area_px?: number | null;
  mask_area_mm2?: number | null;
}

const normalizeAIModelDetails = (details: Partial<AIModelDetails> | null | undefined): AIModelDetails => {
  const safe = details && typeof details === 'object' ? details : {};
  return {
    model_type: typeof safe.model_type === 'string' ? safe.model_type : 'unknown',
    version: typeof safe.version === 'string' ? safe.version : '',
    description: typeof safe.description === 'string' ? safe.description : '',
    supported_modalities: Array.isArray(safe.supported_modalities) ? safe.supported_modalities : [],
    performance_metrics:
      safe.performance_metrics && typeof safe.performance_metrics === 'object'
        ? safe.performance_metrics
        : {},
    reference: typeof safe.reference === 'string' ? safe.reference : null,
    license: typeof safe.license === 'string' ? safe.license : null,
    class_names: Array.isArray(safe.class_names) ? safe.class_names : [],
    input_size: Array.isArray(safe.input_size) ? safe.input_size : [],
    output_channels: typeof safe.output_channels === 'number' ? safe.output_channels : null,
  };
};

const normalizeAIModelRequirements = (
  requirements: Partial<AIModelRequirements> | null | undefined
): AIModelRequirements => {
  const safe = requirements && typeof requirements === 'object' ? requirements : {};
  return {
    enabled: typeof safe.enabled === 'boolean' ? safe.enabled : false,
    device: typeof safe.device === 'string' ? safe.device : null,
    weights_path: typeof safe.weights_path === 'string' ? safe.weights_path : null,
  };
};

const normalizeAIModelWeights = (weights: Partial<AIModelWeights> | null | undefined): AIModelWeights => {
  const safe = weights && typeof weights === 'object' ? weights : {};
  return {
    path: typeof safe.path === 'string' ? safe.path : null,
    exists: typeof safe.exists === 'boolean' ? safe.exists : false,
    size_bytes: typeof safe.size_bytes === 'number' ? safe.size_bytes : null,
    sha256: typeof safe.sha256 === 'string' ? safe.sha256 : null,
  };
};

const normalizeAIModel = (model: Partial<AIModel> | null | undefined): AIModel => {
  const safe = model && typeof model === 'object' ? model : {};
  return {
    name: typeof safe.name === 'string' ? safe.name : 'Unknown model',
    available: typeof safe.available === 'boolean' ? safe.available : false,
    status: typeof safe.status === 'string' ? safe.status : 'unknown',
    details: normalizeAIModelDetails(safe.details),
    requirements: normalizeAIModelRequirements(safe.requirements),
    weights: normalizeAIModelWeights(safe.weights),
    last_checked: typeof safe.last_checked === 'string' ? safe.last_checked : null,
    errors: Array.isArray(safe.errors) ? safe.errors : [],
  };
};

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

const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
};

const appendAuthToken = (params: URLSearchParams): void => {
  const token = getAuthToken();
  if (token) {
    params.set('token', token);
  }
};

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
      const payload = response.data as unknown as {
        total?: number;
        page?: number;
        page_size?: number;
        studies?: StudyPayload[];
      };
      const rawStudies = Array.isArray(payload.studies) ? payload.studies : [];
      return {
        total: typeof payload.total === 'number' ? payload.total : 0,
        page: typeof payload.page === 'number' ? payload.page : 1,
        page_size: typeof payload.page_size === 'number' ? payload.page_size : rawStudies.length,
        studies: rawStudies.map((study) => normalizeStudy(study)),
      };
    },

    /**
     * Get a single study by UID.
     */
    async get(studyUid: string): Promise<Study> {
      const response = await apiClient.get(`/studies/${studyUid}`);
      const payload = response.data as
        | StudyPayload
        | {
            study?: StudyPayload;
          };
      const rawStudy =
        payload && typeof payload === 'object' && 'study' in payload && payload.study
          ? payload.study
          : (payload as StudyPayload);
      return normalizeStudy(rawStudy as StudyPayload);
    },

    /**
     * Upload DICOM files to create/update studies.
     */
    async upload(
      files: File[],
      onProgress?: (progress: UploadProgress[]) => void
    ): Promise<{ studies_created: string[]; instances_stored: number }> {
      const formData = new FormData();
      const fileSizes = files.map((file) => file.size || 0);
      const totalSize = fileSizes.reduce((sum, size) => sum + size, 0);
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await apiClient.post('/studies', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60 * 60 * 1000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        onUploadProgress: (progressEvent) => {
          if (!onProgress) return;
          const total = progressEvent.total || totalSize || 1;
          const loaded = Math.min(progressEvent.loaded, total);
          let remaining = loaded;

          onProgress(
            files.map((f, index) => {
              const size = fileSizes[index] || 0;
              const fileLoaded = size ? Math.min(size, Math.max(remaining, 0)) : 0;
              remaining = Math.max(remaining - fileLoaded, 0);
              const overallProgress = Math.round((loaded * 100) / total);
              const fileProgress = size ? Math.round((fileLoaded * 100) / size) : overallProgress;
              return {
                file_name: f.name,
                progress: Math.min(fileProgress, 100),
                status: overallProgress < 100 ? 'uploading' : 'processing',
              };
            })
          );
        },
      });

      return response.data;
    },

    /**
     * Update study metadata.
     */
    async update(studyUid: string, payload: StudyUpdateRequest): Promise<Study> {
      const response = await apiClient.patch<StudyPayload>(`/studies/${studyUid}`, payload);
      return normalizeStudy(response.data as StudyPayload);
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
     * Update series metadata.
     */
    async update(seriesUid: string, payload: SeriesUpdateRequest): Promise<SeriesDetailResponse> {
      const response = await apiClient.patch<SeriesDetailResponse>(`/series/${seriesUid}`, payload);
      return response.data;
    },

    /**
     * Get 3D volume information for MPR/VR.
     */
    async getVolumeInfo(seriesUid: string): Promise<VolumeInfo> {
      const response = await apiClient.get<VolumeInfo>(`/series/${seriesUid}/volume-info`);
      return response.data;
    },

    /**
     * Get an MPR slice image URL for a series.
     */
    getMprUrl(
      seriesUid: string,
      options?: {
        plane?: 'axial' | 'coronal' | 'sagittal';
        index?: number;
        windowCenter?: number;
        windowWidth?: number;
        format?: 'png' | 'jpeg';
      }
    ): string {
      const params = new URLSearchParams();
      if (options?.plane) params.set('plane', options.plane);
      if (options?.index !== undefined) params.set('index', options.index.toString());
      if (options?.windowCenter !== undefined) params.set('window_center', options.windowCenter.toString());
      if (options?.windowWidth !== undefined) params.set('window_width', options.windowWidth.toString());
      if (options?.format) params.set('format', options.format);
      appendAuthToken(params);
      const queryString = params.toString();
      return `/api/v1/series/${seriesUid}/mpr${queryString ? `?${queryString}` : ''}`;
    },

    async trackMeasurement(
      seriesUid: string,
      payload: TrackMeasurementRequest
    ): Promise<TrackMeasurementResponse> {
      const response = await apiClient.post<TrackMeasurementResponse>(
        `/series/${seriesUid}/track-measurement`,
        payload
      );
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
      appendAuthToken(params);

      const queryString = params.toString();
      return `/api/v1/instances/${instanceUid}/pixel-data${queryString ? `?${queryString}` : ''}`;
    },

    /**
     * Get a thumbnail URL for quick series previews.
     */
    getThumbnailUrl(instanceUid: string, size?: number): string {
      const params = new URLSearchParams();
      if (size) params.set('size', size.toString());
      appendAuthToken(params);
      const queryString = params.toString();
      return `/api/v1/instances/${instanceUid}/thumbnail${queryString ? `?${queryString}` : ''}`;
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
      const payload = response.data as unknown as {
        total?: number;
        page?: number;
        page_size?: number;
        studies?: StudyPayload[];
      };
      const rawStudies = Array.isArray(payload.studies) ? payload.studies : [];
      return {
        total: typeof payload.total === 'number' ? payload.total : 0,
        page: typeof payload.page === 'number' ? payload.page : 1,
        page_size: typeof payload.page_size === 'number' ? payload.page_size : rawStudies.length,
        studies: rawStudies.map((study) => normalizeStudy(study)),
      };
    },

    /**
     * Update patient metadata.
     */
    async update(patientId: string, payload: PatientUpdateRequest): Promise<Patient> {
      const response = await apiClient.patch<Patient>(`/patients/${patientId}`, payload);
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
      const payload = response.data as unknown;
      const isObject = typeof payload === 'object' && payload !== null;
      const base = (isObject ? payload : {}) as AIModelsResponse;
      const modelsValue = isObject ? (payload as { models?: unknown }).models : undefined;
      const hasValidModels = Array.isArray(modelsValue);
      const rawModels = hasValidModels ? (modelsValue as Partial<AIModel>[]) : [];
      return {
        ...base,
        models: rawModels.map((model) => normalizeAIModel(model)),
        shape_error: hasValidModels ? null : 'Invalid models payload',
      };
    },

    /**
     * Load an AI model.
     */
    async loadModel(modelId: string): Promise<void> {
      await apiClient.post(`/ai/models/${modelId}/load`);
    },

    /**
     * Run interactive MedSAM segmentation.
     */
    async interactiveMedsam(params: {
      studyUid: string;
      seriesUid: string;
      instanceUid: string;
      frameIndex?: number;
      prompt: {
        points: Array<[number, number]>;
        pointLabels?: number[];
        box?: [number, number, number, number];
      };
    }): Promise<InteractiveSegmentationResponse> {
      const response = await apiClient.post<InteractiveSegmentationResponse>(
        '/ai/interactive/medsam',
        {
          points: params.prompt.points,
          point_labels: params.prompt.pointLabels ?? [],
          box: params.prompt.box,
        },
        {
          params: {
            study_uid: params.studyUid,
            series_uid: params.seriesUid,
            instance_uid: params.instanceUid,
            frame_index: params.frameIndex,
          },
        }
      );
      return response.data;
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
      const response = await apiClient.post<AIJob>('/ai/infer', params);
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
     * Get aggregated AI results for a study.
     */
    async getStudyResults(studyUid: string, taskType?: string): Promise<{
      study_uid: string;
      total_jobs: number;
      segmentations: Record<string, unknown>[];
      detections: Record<string, unknown>[];
      classifications: Record<string, unknown>[];
      pathology: Record<string, unknown>[];
      cardiac: Record<string, unknown>[];
      jobs: Array<{
        job_id: string;
        model_type: string;
        task_type: string;
        completed_at: string | null;
        inference_time_ms: number | null;
        results: Record<string, unknown> | null;
        result_files: Record<string, string> | null;
      }>;
    }> {
      const response = await apiClient.get(`/ai/results/${studyUid}`, {
        params: taskType ? { task_type: taskType } : undefined,
      });
      return response.data;
    },

    /**
     * Build a URL for rendering a segmentation mask overlay.
     */
    getMaskOverlayUrl(
      studyUid: string,
      filename: string,
      sliceIndex: number,
      classId?: number
    ): string {
      const params = new URLSearchParams();
      params.set('slice', sliceIndex.toString());
      if (classId !== undefined) {
        params.set('class_id', classId.toString());
      }
      appendAuthToken(params);
      return `/api/v1/ai/results/${studyUid}/masks/${filename}/render?${params.toString()}`;
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
        return Array.isArray(studies)
          ? studies.map((study) => normalizeStudy(study as unknown as StudyPayload))
          : [];
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
  // Export
  // --------------------------------------------------------------------------
  export: {
    /**
     * Export study with measurements as real DICOM files (SR + SEG).
     * Returns a ZIP file containing DICOM Structured Reports and Segmentation objects.
     */
    async exportDicomWithMeasurements(params: {
      studyUid: string;
      seriesUid: string;
      patientId?: string;
      patientName?: string;
      patientBirthDate?: string;
      patientSex?: string;
      issuerOfPatientId?: string;
      otherPatientIds?: string;
      ethnicGroup?: string;
      patientComments?: string;
      studyId?: string;
      studyDate?: string;
      studyTime?: string;
      studyDescription?: string;
      accessionNumber?: string;
      referringPhysicianName?: string;
      seriesDescription?: string;
      seriesNumber?: number | null;
      bodyPartExamined?: string;
      patientPosition?: string;
      protocolName?: string;
      sliceThickness?: number | null;
      spacingBetweenSlices?: number | null;
      windowCenter?: number | null;
      windowWidth?: number | null;
      modality?: string;
      measurements: Array<{
        id: string;
        type: string;
        label?: string;
        points: Array<{ x: number; y: number }>;
        lengthMm?: number | null;
        areaMm2?: number | null;
        perimeterMm?: number | null;
        frameIndex?: number;
        seriesUid?: string;
        instanceUid?: string;
      }>;
      trackingData?: Array<{
        measurementId: string;
        label?: string;
        frames: Array<{ frameIndex: number; value: number }>;
        minMm?: number | null;
        maxMm?: number | null;
        meanMm?: number | null;
        unit: string;
      }>;
      segmentations?: Array<{
        id: string;
        label: string;
        color?: [number, number, number];
        maskData: number[][];
        frameIndex?: number;
        instanceUid?: string;
      }>;
      includeSr?: boolean;
      includeSeg?: boolean;
      includeOriginal?: boolean;
      authorName?: string;
      institutionName?: string;
    }): Promise<Blob> {
      const response = await apiClient.post('/export/dicom-measurements', {
        study_uid: params.studyUid,
        series_uid: params.seriesUid,
        patient_id: params.patientId,
        patient_name: params.patientName,
        patient_birth_date: params.patientBirthDate,
        patient_sex: params.patientSex,
        issuer_of_patient_id: params.issuerOfPatientId,
        other_patient_ids: params.otherPatientIds,
        ethnic_group: params.ethnicGroup,
        patient_comments: params.patientComments,
        study_id: params.studyId,
        study_date: params.studyDate,
        study_time: params.studyTime,
        study_description: params.studyDescription,
        accession_number: params.accessionNumber,
        referring_physician_name: params.referringPhysicianName,
        series_description: params.seriesDescription,
        series_number: params.seriesNumber,
        body_part_examined: params.bodyPartExamined,
        patient_position: params.patientPosition,
        protocol_name: params.protocolName,
        slice_thickness: params.sliceThickness,
        spacing_between_slices: params.spacingBetweenSlices,
        window_center: params.windowCenter,
        window_width: params.windowWidth,
        modality: params.modality || 'US',
        measurements: params.measurements.map((m) => ({
          id: m.id,
          type: m.type,
          label: m.label,
          points: m.points,
          length_mm: m.lengthMm,
          area_mm2: m.areaMm2,
          perimeter_mm: m.perimeterMm,
          frame_index: m.frameIndex,
          series_uid: m.seriesUid || params.seriesUid,
          instance_uid: m.instanceUid,
        })),
        tracking_data: params.trackingData?.map((t) => ({
          measurement_id: t.measurementId,
          label: t.label,
          frames: t.frames.map((f) => ({
            frame_index: f.frameIndex,
            value: f.value,
          })),
          min_value: t.minMm,
          max_value: t.maxMm,
          mean_value: t.meanMm,
          unit: t.unit,
        })) || [],
        segmentations: params.segmentations?.map((s) => ({
          id: s.id,
          label: s.label,
          color: s.color || [255, 0, 0],
          mask_data: s.maskData,
          frame_index: s.frameIndex,
          instance_uid: s.instanceUid,
        })) || [],
        include_sr: params.includeSr ?? true,
        include_seg: params.includeSeg ?? true,
        include_original: params.includeOriginal ?? true,
        author_name: params.authorName,
        institution_name: params.institutionName,
      }, {
        responseType: 'blob',
        timeout: 120000, // 2 minutes for large exports
      });
      return response.data;
    },

    /**
     * Download a blob as a file.
     */
    downloadBlob(blob: Blob, filename: string): void {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
  },

  // --------------------------------------------------------------------------
  // Admin
  // --------------------------------------------------------------------------
  admin: {
    async getSystemStatus(): Promise<AdminSystemStatus> {
      const response = await apiClient.get('/admin/status');
      return response.data;
    },
    async getStorageInfo(): Promise<AdminStorageInfo> {
      const response = await apiClient.get('/admin/storage');
      return response.data;
    },
    async getUsers(): Promise<AdminUser[]> {
      const response = await apiClient.get('/admin/users');
      return response.data;
    },
    async updateUserRoles(userId: string, roles: string[]): Promise<void> {
      await apiClient.put(`/admin/users/${userId}/roles`, roles);
    },
    async updateUserStatus(userId: string, isActive: boolean): Promise<void> {
      await apiClient.put(`/admin/users/${userId}/status`, isActive);
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
