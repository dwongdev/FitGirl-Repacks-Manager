import PocketBase from "pocketbase";
import { EventSource } from "eventsource";
import { app, Notification } from "electron";
import { getMainWindow } from "./windowService";
import { getAssetPath } from "../utils";
import userDataService from "./userDataService";

global.EventSource = EventSource;

class NotificationService {
  private pb: PocketBase | null = null;
  private unsubscribe: (() => void) | null = null;

  async start() {
    if (this.unsubscribe) {
      console.log("[NotificationService] Already subscribed, skipping start.");
      return;
    }

    const pbUrl =
      process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";
    const COLLECTION_NAME = "FitData";

    if (!pbUrl) {
      console.warn(
        "[NotificationService] PocketBase URL missing. Real-time notifications disabled.",
      );
      return;
    }

    this.pb = new PocketBase(pbUrl);

    console.log(
      `[NotificationService] Subscribing to "${COLLECTION_NAME}" (Realtime enabled: ${!!this.pb})`,
    );
    console.log(`[NotificationService] URL: ${pbUrl}`);

    try {
      this.unsubscribe = await this.pb
        .collection(COLLECTION_NAME)
        .subscribe("*", (e) => {
          console.log(
            "[NotificationService] EVENT RECEIVED:",
            e.action,
            "on collection",
            COLLECTION_NAME,
          );

          if (e.record && e.action === "create") {
            console.log(
              `[NotificationService] Processing ${e.action} for:`,
              e.record.PostTitle,
            );
            this.handleNewRepack(e.record, "INSERT");
          }
        });

      console.log("[NotificationService] Successfully subscribed to Realtime!");
    } catch (err: any) {
      console.error(
        "[NotificationService] Failed to subscribe to Realtime:",
        err.message,
      );
    }
  }

  async stop() {
    if (this.unsubscribe) {
      console.log("[NotificationService] Unsubscribing from Realtime...");
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.pb = null;
  }

  private async handleNewRepack(repack: any, eventType: string = "INSERT") {
    const settings = await userDataService.getData("settings");
    const mode = settings.notificationMode || "all";

    if (mode === "disabled") {
      console.log(
        "[NotificationService] Notifications disabled in settings, skipping.",
      );
      return;
    }

    console.log(
      `[NotificationService] Processing repack (${eventType}): "${repack.PostTitle}" with mode: ${mode}`,
    );

    if (mode === "library") {
      const data = await userDataService.getData();
      const libraryGames = Object.values(data.virtualGames || {});
      const newTitle = this.normalizeTitle(repack.PostTitle);

      const hasMatch = libraryGames.some((game: any) => {
        const libTitle = this.normalizeTitle(game.name || "");
        return (
          libTitle.includes(newTitle) ||
          newTitle.includes(libTitle) ||
          this.levenshtein(libTitle, newTitle) < 3
        );
      });

      if (!hasMatch) {
        console.log(
          `[NotificationService] Repack "${repack.PostTitle}" not in library, skipping.`,
        );
        return;
      }
      console.log(
        `[NotificationService] Match found in library for "${repack.PostTitle}"!`,
      );
    }
    if (!repack.PostTitle) return;

    const postTitle = repack.PostTitle || "New Repack Added!";

    // In dev mode, we want to allow Test Repack notifications for testing
    const isDev = !app.isPackaged;
    if (!isDev && postTitle === "Test Repack") return;
    if (!postTitle) return;

    if (Notification.isSupported()) {
      const isUpdate = eventType === "UPDATE";
      const notification = new Notification({
        icon: getAssetPath("app_icon.png"),
        urgency: "critical",
        title: isUpdate ? "Repack Updated!" : "New FitGirl Repack!",
        body: postTitle,
        silent: false,
      });

      notification.on("click", () => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();

          mainWindow.webContents.send("navigate-to-repack", repack);
        }
      });

      notification.show();
    }

    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("new-repack-notification", repack);
    }
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private levenshtein(s: string, t: string): number {
    if (!s) return t.length;
    if (!t) return s.length;
    const array: number[][] = [];
    for (let i = 0; i <= t.length; i++) array[i] = [i];
    for (let j = 0; j <= s.length; j++) array[0][j] = j;

    for (let i = 1; i <= t.length; i++) {
      for (let j = 1; j <= s.length; j++) {
        array[i][j] =
          t[i - 1] === s[j - 1]
            ? array[i - 1][j - 1]
            : Math.min(array[i - 1][j - 1], array[i][j - 1], array[i - 1][j]) +
              1;
      }
    }
    return array[t.length][s.length];
  }
}

export const notificationService = new NotificationService();
export default notificationService;
