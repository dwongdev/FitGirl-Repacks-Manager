import { ipcMain, BrowserWindow } from "electron";
import {
  checkForUpdates,
  downloadUpdate,
  cancelDownload,
  launchInstaller,
  performUpdateCheck,
} from "../services/updaterService";

export function registerUpdaterHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle("updater-check", async () => {
    try {
      return { success: true, data: await checkForUpdates() };
    } catch (err: any) {
      console.error("[Updater] Check failed:", err);
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle("updater-download", async (_event, url: string, assetName: string) => {
    try {
      const destPath = await downloadUpdate(url, assetName, (progress) => {
        mainWindow.webContents.send("updater-download-progress", progress);
      });
      return { success: true, destPath };
    } catch (err: any) {
      console.error("[Updater] Download failed:", err);
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle("updater-cancel", () => {
    const cancelled = cancelDownload();
    return { success: cancelled };
  });

  ipcMain.handle("updater-install", (_event, installerPath: string) => {
    try {
      launchInstaller(installerPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle("updater-check-and-notify", async () => {
    try {
      await performUpdateCheck(mainWindow);
      return { success: true };
    } catch (err: any) {
      console.error("[Updater] Manual check failed:", err);
      return { success: false, error: err?.message ?? String(err) };
    }
  });
}
