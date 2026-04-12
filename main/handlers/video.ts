import { ipcMain, app } from "electron";
import { create as createYoutubeDl } from "yt-dlp-exec";
import path from "path";

export function registerVideoHandlers() {
  // Resolve the path to the yt-dlp binary
  // When packaged, it will be in app.asar.unpacked due to our asarUnpack config
  const isPackaged = app.isPackaged;
  const binName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const binaryPath = isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "yt-dlp-exec",
        "bin",
        binName
      )
    : path.join(
        app.getAppPath(),
        "node_modules",
        "yt-dlp-exec",
        "bin",
        binName
      );

  console.log(`[VideoHandler] Using yt-dlp binary at: ${binaryPath}`);
  const youtubedl = createYoutubeDl(binaryPath);

  ipcMain.handle("get-video-source", async (_event, videoId: string) => {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      console.log(`[Main] Extracting video source for ID: ${videoId}`);

      const output = await youtubedl(videoUrl, {
        dumpSingleJson: true,
        noWarnings: true,
        preferFreeFormats: true,
        noCheckCertificate: true,
        noPlaylist: true,
      });

      // Find a format that has both video and audio, or fallback to the best one
      const format =
        output.formats.find(
          (f: any) => f.vcodec !== "none" && f.acodec !== "none",
        ) || output.formats[0];

      if (!format || !format.url) {
        throw new Error("Could not find a valid video format");
      }

      console.log(`[Main] Successfully extracted URL for ${videoId}`);
      return { success: true, url: format.url, videoId, videoUrl };
    } catch (error: any) {
      console.error(`[Main] Video extraction error for ${videoId}:`, error);

      let isAgeRestricted = false;
      if (error.message && error.message.includes("Sign in to confirm your age")) {
        isAgeRestricted = true;
      }

      return {
        success: false,
        error: error.message,
        isAgeRestricted,
        videoId,
        videoUrl,
      };
    }
  });
}
