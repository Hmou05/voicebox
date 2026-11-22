import { useMutation, useQueryClient } from '@tanstack/react-query';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, simple, useState } from 'react';
import type { PillState } from '@/components/CapturePill/CapturePill';
import { apiClient } from '@/lib/api/client';
import type {
  CaptureListResponse,
  CaptureResponse,
  CaptureSource,
} from '@/lib/api/types';
import { useAudioRecording } from '@/lib/hooks/useAudioRecording';

export const MICROPHONE_PERMISSION_ERROR = 'Microphone permission was denied. Re-request access or allow it in your system settings.';

function broadcastCreated(capture: CaptureResponse) {
  tauriEmit('capture:created', { capture }).catch(() => {});
}

function broadcastUpdated(id: string) {
  tauriEmit('capture:updated', { id }).catch(() => {});
}

const REST_FADE_MS = 900;
const COMPLETED_DWELL_MS = 2000;
const ERROR_PILL_VISIBLE_MS = 6000;
const BRIEF_NOTICE_MS = 2000;
const MIN_RECORDING_DURATION_S = 0.5;
const SHORT_RECORDING_MESSAGE = 'Recording too short, canceled';

export type CapturePillState = PillState | 'hidden';

export interface UseCaptureRecordingSessionOptions {
  onCaptureCreated?: (capture: CaptureResponse) => void;
  onFinalText?: (
    text: string,
    capture: CaptureResponse,
    allowAutoPaste: boolean,
  ) => void;
}

export interface UseCaptureRecordingSessionResult {
  pillState: CapturePillState;
  pillElapsedMs: number;
  errorMessage: string | null;
  canRerequestMicrophone: boolean;
  isRecording: boolean;
  isUploading: boolean;
  isRefining: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  toggleRecording: () => void;
  rerequestMicrophone: () => void;
  dismissError: () => void;
  uploadFile: (file: File, source: CaptureSource) => void;
  refine: (captureId: string) => void;
}

export function useCaptureRecordingSession(
  options: UseCaptureRecordingSessionOptions = {},
): UseCaptureRecordingSessionResult {
  const queryClient = useQueryClient();
  const [pillState, setPillState] = useState<CapturePillState>('hidden');
  const [frozenElapsedMs, setFrozenElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canRerequestMicrophone, setCanRerequestMicrophone] = useState(false);
  const restTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const pillStateRef = useRef<CapturePillState>('hidden');
  pillStateRef.current = pillState;
  const onCaptureCreatedRef = useRef(options.onCaptureCreated);
  onCaptureCreatedRef.current = options.onCaptureCreated;
  const onFinalTextRef = useRef(options.onFinalText);
  onFinalTextRef.current = options.onFinalText;
  const allowAutoPasteRef = useRef<boolean>(true);

  const clearRestTimer = useCallback(() => {
    if (restTimerRef.current !== null) {
      window.clearTimeout(restTimerRef.current);
      restTimerRef.current = null;
    }
  }, []);

  const clearErrorTimer = useCallback(() => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const scheduleHidePill = useCallback(() => {
    clearRestTimer();
    setPillState('completed');
    restTimerRef.current = window.setTimeout(() => {
      setPillState('rest');
      restTimerRef.current = window.setTimeout(() => {
        setPillState('hidden');
        restTimerRef.current = null;
      }, REST_FADE_MS);
    }, COMPLETED_DWELL_MS);
  }, [clearRestTimer]);

  const showError = useCallback(
    (message: string, durationMs: number = ERROR_PILL_VISIBLE_MS) => {
      clearRestTimer();
      clearErrorTimer();
      setErrorMessage(message || 'Something went wrong');
      setCanRerequestMicrophone(/permission|microphone access denied|notallowed/i.test(message));
      setPillState('error');
      errorTimerRef.current = window.setTimeout(() => {
        setPillState('hidden');
        setErrorMessage(null);
        setCanRerequestMicrophone(false);
        errorTimerRef.current = null;
      }, durationMs);
    },
    [clearRestTimer, clearErrorTimer],
  );

  const dismissError = useCallback(() => {
    clearErrorTimer();
    setPillState('hidden');
    setErrorMessage(null);
    setCanRerequestMicrophone(false);
  }, [clearErrorTimer]);

  useEffect(
    () => () => {
      clearRestTimer();
      clearErrorTimer();
    },
    [clearRestTimer, clearErrorTimer],
  );

  const refineMutation = useMutation({
    mutationFn: async (captureId: string) => apiClient.refineCapture(captureId, {}),
    onSuccess: (data, captureId) => {
      queryClient.invalidateQueries({ queryKey: ['captures'] });
      broadcastUpdated(captureId);
      if (pillStateRef.current === 'refining') scheduleHidePill();
      const finalText = data.transcript_refined ?? data.transcript_raw;
      if (finalText) onFinalTextRef.current?.(finalText, data, allowAutoPasteRef.current);
    },
    onError: (err: Error) => showError(err.message || 'Refinement failed'),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, source }: { file: File; source: CaptureSource }) =>
      apiClient.createCapture(file, { source }),
    onSuccess: (capture) => {
      queryClient.setQueryData<CaptureListResponse>(['captures'], (prev) => {
        if (!prev) return prev;
        if (prev.items.some((c) => c.id === capture.id)) return prev;
        return { ...prev, items: [capture, ...prev.items], total: prev.total + 1 };
      });
      queryClient.invalidateQueries({ queryKey: ['captures'] });
      broadcastCreated(capture);
      onCaptureCreatedRef.current?.(capture);
      allowAutoPasteRef.current = capture.allow_auto_paste;
      if (capture.auto_refine) {
        setPillState('refining');
        refineMutation.mutate(capture.id);
      } else {
        if (pillStateRef.current === 'transcribing') scheduleHidePill();
        if (capture.transcript_raw) {
          onFinalTextRef.current?.(capture.transcript_raw, capture, capture.allow_auto_paste);
        }
      }
    },
    onError: (err: Error) => {
      const msg = err.message || '';
      if (/could not decode/i.test(msg) || /empty or corrupt/i.test(msg)) {
        showError(SHORT_RECORDING_MESSAGE, BRIEF_NOTICE_MS);
      } else {
        showError(msg || 'Upload failed');
      }
    },
  });

  const {
    isRecording,
    duration,
    startRecording: beginAudioRecording,
    stopRecording,
    error: recordError,
  } = useAudioRecording({
    onRecordingComplete: (blob, recordedDuration) => {
      if (!blob.size || (recordedDuration ?? 0) < MIN_RECORDING_DURATION_S) {
        showError(SHORT_RECORDING_MESSAGE, BRIEF_NOTICE_MS);
        return;
      }
      setFrozenElapsedMs(Math.round((recordedDuration ?? 0) * 1000));
      setPillState('transcribing');
      setCanRerequestMicrophone(false);
      const extension = blob.type.includes('wav')
        ? 'wav'
        : blob.type.includes('webm')
          ? 'webm'
          : 'bin';
      const file = new File([blob], `dictation-${Date.now()}.${extension}`, {
        type: blob.type,
      });
      uploadMutation.mutate({ file, source: 'dictation' });
    },
  });

  useEffect(() => {
    if (recordError) showError(recordError);
  }, [recordError, showError]);

  const startRecording = useCallback(() => {
    if (isRecording) return;
    clearRestTimer();
    clearErrorTimer();
    setFrozenElapsedMs(0);
    setErrorMessage(null);
    setCanRerequestMicrophone(false);
    setPillState('recording');
    beginAudioRecording();
  }, [isRecording, beginAudioRecording, clearRestTimer, clearErrorTimer]);

  const rerequestMicrophone = useCallback(() => {
    clearErrorTimer();
    setErrorMessage(null);
    setCanRerequestMicrophone(false);
    setPillState('recording');
    beginAudioRecording();
  }, [beginAudioRecording, clearErrorTimer]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const uploadFile = useCallback(
    (file: File, source: CaptureSource) => uploadMutation.mutate({ file, source }),
    [uploadMutation],
  );

  const refine = useCallback(
    (captureId: string) => refineMutation.mutate(captureId),
    [refineMutation],
  );

  const pillElapsedMs = pillState === 'recording' ? Math.round(duration * 1000) : frozenElapsedMs;

  return {
    pillState,
    pillElapsedMs,
    errorMessage,
    canRerequestMicrophone,
    isRecording,
    isUploading: uploadMutation.isPending,
    isRefining: refineMutation.isPending,
    startRecording,
    stopRecording,
    toggleRecording,
    rerequestMicrophone,
    dismissError,
    uploadFile,
    refine,
  };
}
