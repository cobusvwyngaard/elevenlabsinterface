export interface AudioTypePreset {
  diarize?: boolean;
  num_speakers?: number | null;
  tag_audio_events?: boolean;
  timestamps_granularity?: string;
  no_verbatim?: boolean;
}

export const AUDIO_TYPE_PRESETS: Record<string, AudioTypePreset> = {
  lecture: {
    diarize: false,
    tag_audio_events: true,
    timestamps_granularity: "word",
    no_verbatim: true,
  },
  meeting: {
    diarize: true,
    tag_audio_events: false,
    timestamps_granularity: "word",
    no_verbatim: true,
  },
  focus_group: {
    diarize: true,
    num_speakers: 6,
    tag_audio_events: true,
    timestamps_granularity: "word",
    no_verbatim: false,
  },
  interview: {
    diarize: true,
    num_speakers: 2,
    tag_audio_events: false,
    timestamps_granularity: "word",
    no_verbatim: true,
  },
  podcast: {
    diarize: true,
    tag_audio_events: true,
    timestamps_granularity: "word",
    no_verbatim: true,
  },
  dictation: {
    diarize: false,
    tag_audio_events: false,
    timestamps_granularity: "word",
    no_verbatim: true,
  },
  custom: {},
};

export function presetFor(audioType: string): AudioTypePreset {
  return AUDIO_TYPE_PRESETS[audioType] ?? {};
}
