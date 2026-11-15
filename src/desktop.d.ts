interface Window {
  signaldeskBoot?: {
    stage(phase: 'interface' | 'service' | 'workspace', version?: string): void;
    ready(): void;
    configure(preferences: unknown): void;
    preview(preferences: unknown): void;
  };
  signaldeskDesktop?: {
    platform?: 'win32' | 'darwin' | 'linux';
    integratedTitlebar?: boolean;
    newWindow(): Promise<void>;
    closeWindow(): Promise<void>;
    nativeMenu(kind: 'edit' | 'view'): Promise<void>;
    savedPreferences?: unknown;
    saveBackground(data: string): Promise<string>;
    readBackground(id: string): Promise<string | null>;
    removeBackground(id: string): Promise<void>;
    savePreferences(value: unknown): Promise<void>;
    onPreferences(callback: (value: unknown) => void): () => void;
    chooseDirectory(initial: string): Promise<string | null>;
    openBluetoothSettings(): Promise<void>;
    openPanel(page: string): Promise<void>;
    getFullscreen(): Promise<boolean>;
    toggleFullscreen(): Promise<void>;
    onFullscreen(callback: (value: boolean) => void): () => void;
  };
}
