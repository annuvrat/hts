export type ClientEvent =
  | { type: "audio_chunk"; pcm: string }
  | { type: "interrupt" };

export type ServerEvent =
  | { type: "state"; value: string }
  | { type: "partial_transcript"; text: string }
  | { type: "agent_audio"; audio: string };
