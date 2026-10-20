declare module "virtual:doomgeneric" {
  interface DoomModule {
    FS: {
      writeFile: (path: string, data: Uint8Array) => void;
      unlink: (path: string) => void;
    };
    HEAPU8: Uint8Array;
    _dg_init: () => void;
    _dg_tick: () => void;
    _dg_key: (pressed: number, key: number) => void;
    _dg_framebuffer: () => number;
    _dg_frames: () => number;
    _dg_inputs: () => number;
    _dg_x: () => number;
    _dg_y: () => number;
  }
  export const wadBase64: string;
  export default function createDoom(options: {
    print: (message: string) => void;
    printErr: (message: string) => void;
  }): Promise<DoomModule>;
}
