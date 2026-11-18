import type { NextHandleFunction } from "vite"; // connect middleware: (req, res, next) => void

export const emulatorShell: NextHandleFunction | ((req: any, res: any, next: (err?: any) => void) => Promise<void>);
export function emulatorHtmlInjection(): (req: any, res: any, next: (err?: any) => void) => void;
