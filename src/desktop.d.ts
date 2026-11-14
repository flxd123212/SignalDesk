interface Window {
  signaldeskDesktop?: {
    integratedTitlebar?: boolean;
    newWindow(): Promise<void>;
    closeWindow(): Promise<void>;
    nativeMenu(kind: 'edit' | 'view'): Promise<void>;
    savedPreferences?: unknown;
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
