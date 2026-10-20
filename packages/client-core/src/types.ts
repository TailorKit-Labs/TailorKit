export interface PatchsmithApp {
  scope?: { name: string };
  views?: { slot: string; path: string; instances?: true; disabled?: true }[];
  clientPath?: string;
  description?: string | null;
  id: string;
  logoPaths?: {
    dark?: string;
    light?: string;
  };
  projectId?: string;
  currentDeployment?: {
    id: string;
  } | null;
  name?: string;
}
