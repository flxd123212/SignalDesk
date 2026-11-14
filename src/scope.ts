export type ChannelScale = { division: number; offset: number; coupling: 'DC' | 'AC'; invert: boolean };
export type ScopeSettings = { manual: boolean; channels: ChannelScale[]; cursors: boolean; cursorA: number; cursorB: number; activeCursor: 'A' | 'B'; peak: { frequency: number; amplitude: number; resolution: number } | null; triggerTime: number | null; spectrumSpan?: number | null; spectrumDivision?: number | null };
export const defaultChannelScale: ChannelScale = { division: 1, offset: 0, coupling: 'DC', invert: false };
