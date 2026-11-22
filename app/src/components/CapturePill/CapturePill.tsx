import { motion } from 'framer-motion';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

export type PillState =
  | 'recording'
  | 'transcribing'
  | 'refining'
  | 'speaking'
  | 'completed'
  | 'rest'
  | 'error';

const PILL_LABEL_KEYS: Record<Exclude<PillState, 'rest' | 'error'>, string> = {
  recording: 'captures.pill.recording',
  transcribing: 'captures.pill.transcribing',
  refining: 'captures.pill.refining',
  speaking: 'captures.pill.speaking',
  completed: 'captures.pill.completed',
};

function barModeFor(state: Exclude<PillState, 'error'>): 'generating' | 'playing' | 'idle' {
  if (state === 'recording' || state === 'speaking') return 'playing';
  if (state === 'completed' || state === 'rest') return 'idle';
  return 'generating';
}

export function PillAudioBars({ mode }: { mode: 'generating' | 'playing' | 'idle' }) {
  return (
    <div className="flex items-center gap-[2px] h-5 shrink-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={`${mode}-${i}`}
          className={cn('w-[3px] rounded-full', mode === 'idle' ? 'bg-accent/30' : 'bg-accent')}
          animate={mode === 'generating'
            ? { height: ['6px', '16px', '6px'] }
            : mode === 'playing'
              ? { height: ['8px', '14px', '4px', '12px', '8px'] }
              : { height: '8px' }}
          transition={mode === 'generating'
            ? { duration: 0.6, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }
            : mode === 'playing'
              ? { duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }
              : { duration: 0.4, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CapturePill({
  state,
  elapsedMs,
  onStop,
  errorMessage,
  onDismiss,
  onRerequestMicrophone,
  canRerequestMicrophone,
  className,
}: {
  state: PillState;
  elapsedMs: number;
  onStop?: () => void;
  errorMessage?: string | null;
  onDismiss?: () => void;
  onRerequestMicrophone?: () => void;
  canRerequestMicrophone?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  if (state === 'error') {
    return (
      <ErrorPill
        message={errorMessage ?? t('captures.pill.errorFallback')}
        onDismiss={onDismiss}
        onRerequestMicrophone={onRerequestMicrophone}
        canRerequestMicrophone={canRerequestMicrophone}
        className={className}
      />
    );
  }

  const visible = state !== 'rest';
  const labelText = t(state === 'rest' ? PILL_LABEL_KEYS.recording : PILL_LABEL_KEYS[state]);
  const barMode = barModeFor(state);

  const dot = (
    <span className="relative flex h-2 w-2 shrink-0">
      {state === 'recording' && <span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-70" />}
      <span className="relative rounded-full h-2 w-2 bg-accent" />
    </span>
  );

  const stopButton = onStop && state === 'recording' ? (
    <button
      type="button"
      onClick={onStop}
      aria-label={t('captures.pill.stopAria')}
      className="relative flex h-2 w-2 shrink-0 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-accent/50"
    >
      {dot}
    </button>
  ) : dot;

  const completedStroke = state === 'completed'
    ? 'shadow-[inset_0_0_0_2px_hsl(var(--accent)/0.6)]'
    : null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 px-4 h-10 rounded-full text-accent',
        'bg-white/80 ring-1 ring-black/5 shadow-lg backdrop-blur-xl',
        'dark:bg-black/55 dark:ring-0 dark:shadow-none dark:backdrop-blur-md',
        completedStroke,
        'transition-opacity duration-300 ease-out',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        className,
      )}
    >
      {stopButton}
      <span className="text-sm font-medium shrink-0" style={{ minWidth: '104px' }}>{labelText}</span>
      <PillAudioBars mode={barMode} />
      <span className="text-xs tabular-nums text-accent/70 font-medium shrink-0 -ml-1">{formatElapsed(elapsedMs)}</span>
    </div>
  );
}

function ErrorPill({
  message,
  onDismiss,
  onRerequestMicrophone,
  canRerequestMicrophone,
  className,
}: {
  message: string;
  onDismiss?: () => void;
  onRerequestMicrophone?: () => void;
  canRerequestMicrophone?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {}
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 h-10 rounded-full',
        'bg-white/85 ring-1 ring-destructive/25 shadow-lg backdrop-blur-xl text-red-600',
        'dark:bg-black/65 dark:ring-0 dark:shadow-none dark:backdrop-blur-md dark:text-red-300',
        'max-w-[520px] transition-colors',
        className,
      )}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={t('captures.pill.errorCopyTooltip')}
        aria-label={t('captures.pill.errorCopyTooltip')}
        className="flex items-center gap-2 min-w-0 focus:outline-none focus:ring-2 focus:ring-red-400/50 rounded-full"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm font-medium truncate max-w-[240px]">{message}</span>
      </button>
      {canRerequestMicrophone ? (
        <button
          type="button"
          onClick={onRerequestMicrophone}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/50"
        >
          <RefreshCw className="h-3 w-3" />
          {t('captures.pill.rerequestMicrophone')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('common.close')}
        className="text-xs text-red-600/70 hover:text-red-700 dark:text-red-300/70 dark:hover:text-red-200"
      >
        {t('common.close')}
      </button>
    </div>
  );
}
