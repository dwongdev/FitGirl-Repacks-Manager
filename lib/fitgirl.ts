import { pb } from "./pocketbase";

export const ensureHttps = (url: string) => {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
};

export interface GameUpdate {
  Name: string;
  Link: string;
}

export interface MediaItem {
  type: "image" | "video";
  url: string;
}

export interface DirectLinks {
  Hoster: string;
  Links: Record<string, string[]>;
}

export interface TorrentLink {
  Source: string;
  Magnet: string;
  TorrentFile: string;
  ExternalLink: string;
}

export interface FitGirlPost {
  id: string; // PocketBase internal ID
  PostID: string;
  Timestamp: string;
  PostTitle: string;
  PostLink: string;
  PostFileOriginalSize: string;
  PostFileRepackSize: string;
  DirectLinks: DirectLinks[];
  TorrentLinks: TorrentLink[];
  GameUpdates: GameUpdate[];
  Media: MediaItem[];
  RepackFeatures: string[];
  GameDescription: string | null;
  CoverImage: string;
  Genres: string[];
  Companies: string;
  Languages: string;
}

export interface SearchFilters {
  search?: string;
  genres?: string[];
  dateFrom?: string;
  dateTo?: string;
  unreadOnly?: boolean;
  showAdult?: boolean;
  readIds?: string[];
  mode?: "all" | "hypervisor" | "top" | "top-week" | "top-month" | "top-year";
}

export interface PostsResponse {
  items: FitGirlPost[];
  total: number;
}

const COLLECTION_NAME = "FitData";
const GENERIC_WORDS = new Set([
  "the",
  "and",
  "&",
  "of",
  "a",
  "an",
  "for",
  "with",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "edition",
  "collectors",
  "limited",
  "gold",
  "ultimate",
  "deluxe",
  "repack",
  "build",
  "version",
  "complete",
  "remastered",
  "remake",
  "definitive",
  "digital",
  "game",
  "year",
  "goty",
  "standard",
  "bundle",
  "bonus",
  "all",
  "dlc",
  "dlcs",
  "update",
  "directors",
  "cut",
  "plus",
  "v1",
  "v2",
  "v3",
  "v4",
]);

interface ThinIndexItem {
  id: string;
  PostID: string;
  Timestamp: string;
}

class FitGirlService {
  private thinIndex: ThinIndexItem[] | null = null;
  private lastIndexFetch: number = 0;
  private readonly INDEX_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

  private async getThinIndex(): Promise<ThinIndexItem[]> {
    const now = Date.now();
    if (this.thinIndex && now - this.lastIndexFetch < this.INDEX_CACHE_TTL) {
      return this.thinIndex;
    }

    try {
      const resp = await fetch(`${pb.baseUrl}/api/fitgirl/index`);
      if (!resp.ok) throw new Error("Failed to fetch index");
      this.thinIndex = await resp.json();
      this.lastIndexFetch = now;
      return this.thinIndex || [];
    } catch (err) {
      console.error("Failed to fetch thin index:", err);
      return [];
    }
  }

  private buildSearchFilter(search: string): string {
    if (!search) return "";

    // Normalize: replace some characters with space before splitting
    let clean = search.toLowerCase();

    // Split into words by anything non-alphanumeric
    const words = clean
      .split(/[^a-z0-9]/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 || /\d/.test(w)) // Keep words like "G2" or "3", ignore "a", "s"
      .filter((w) => !GENERIC_WORDS.has(w));

    if (words.length === 0) {
      // Fallback if everything is filtered (e.g. searching for "The")
      const literal = search.replace(/"/g, '\\"');
      return `PostTitle ~ "${literal}"`;
    }

    return words.map((w) => `PostTitle ~ "${w}"`).join(" && ");
  }


  async getLatestPosts(
    page = 1,
    pageSize = 20,
    filters: SearchFilters = {},
  ): Promise<PostsResponse> {
    try {
      const effectiveGenres = [...(filters.genres || [])];
      const tags: Record<string, string> = {
        hypervisor: "HYPERVISOR",
        top: "Top",
        "top-week": "TopWeek",
        "top-month": "TopMonth",
        "top-year": "TopYear",
      };

      if (filters.mode && tags[filters.mode]) {
        const tag = tags[filters.mode];
        if (!effectiveGenres.includes(tag)) effectiveGenres.push(tag);
      }

      const queryFilters: string[] = [];

      if (filters.search) {
        queryFilters.push(`(${this.buildSearchFilter(filters.search)})`);
      }

      if (effectiveGenres.length > 0) {
        effectiveGenres.forEach((g) => {
          queryFilters.push(`Genres ~ "${g}"`);
        });
      }

      if (filters.dateFrom) {
        queryFilters.push(`Timestamp >= "${filters.dateFrom}"`);
      }

      if (filters.dateTo) {
        queryFilters.push(`Timestamp <= "${filters.dateTo}"`);
      }

      // Note: We no longer add every readId to the query filter to avoid massive URL lengths.
      // Instead, we will filter them in the service layer if the list is too long.
      const useServerSideExclusion =
        filters.unreadOnly &&
        filters.readIds &&
        filters.readIds.length > 0 &&
        filters.readIds.length < 100;

      if (useServerSideExclusion) {
        const ids = filters
          .readIds!.map((id) => `id != "${id}"`) // Optimized for internal IDs
          .join(" && ");
        queryFilters.push(`(${ids})`);
      }

      if (!filters.showAdult) {
        queryFilters.push('Genres !~ "Adult"');
        queryFilters.push('Genres !~ "Hentai"');
        queryFilters.push('Genres !~ "Nudity"');
      }

      let sort = "-Timestamp";
      if (filters.mode === "top-week") sort = "+TopRankWeek";
      else if (filters.mode === "top-month") sort = "+TopRankMonth";
      else if (filters.mode === "top-year") sort = "+TopRankYear";

      let finalItems: FitGirlPost[] = [];
      let totalItems = 0;

      if (
        filters.unreadOnly &&
        filters.readIds &&
        filters.readIds.length >= 100
      ) {
        // --- High-Performance Thin Index Filtering ---
        const index = await this.getThinIndex();

        // Use a Set of internal record IDs for the fastest possible check
        const readSet = new Set(filters.readIds);

        // 1. Filter the entire index locally (Instant!)
        // Note: readIds from the new relation-based system are record IDs (e.g. "abc123xyz")
        const unreadIndexItems = index.filter((item) => !readSet.has(item.id));
        totalItems = unreadIndexItems.length;

        // 2. Identify the specific IDs for the requested page
        const start = (page - 1) * pageSize;
        const pageItems = unreadIndexItems.slice(start, start + pageSize);

        if (pageItems.length > 0) {
          // 3. Targeted fetch of ONLY the full records we need
          const filter = pageItems
            .map((item) => `id = "${item.id}"`)
            .join(" || ");
          const batch = await pb
            .collection(COLLECTION_NAME)
            .getList(1, pageSize, {
              filter: filter,
              sort: sort,
            });
          finalItems = batch.items.map((row) => this.mapRowToPostSync(row));
        }
      } else {
        // Regular fetching with server-side filtering (efficient for small filters)
        const list = await pb
          .collection(COLLECTION_NAME)
          .getList(page, pageSize, {
            filter: queryFilters.join(" && "),
            sort: sort,
          });

        finalItems = list.items.map((row) => this.mapRowToPostSync(row));
        totalItems = list.totalItems;
      }

      return {
        items: finalItems,
        total: totalItems,
      };
    } catch (error) {
      console.error("Error fetching latest posts from PocketBase:", error);
      return { items: [], total: 0 };
    }
  }

  private mapRowToPostSync(row: any): FitGirlPost {
    return {
      id: row.id,
      PostID: row.PostID,
      Timestamp: row.Timestamp,
      PostTitle: row.PostTitle || "",
      PostLink: row.PostLink || "",
      PostFileOriginalSize: row.PostFileOriginalSize || "",
      PostFileRepackSize: row.PostFileRepackSize || "",
      DirectLinks: row.DirectLinks || [],
      TorrentLinks: row.TorrentLinks || [],
      GameUpdates: row.GameUpdates || [],
      Media: row.Media || [],
      RepackFeatures: row.RepackFeatures || [],
      GameDescription: row.GameDescription || null,
      CoverImage: row.CoverImage || "",
      Genres: row.Genres || [],
      Companies: row.Companies || "",
      Languages: row.Languages || "",
    };
  }

  async getAvailableGenres(): Promise<string[]> {
    try {
      const records = await pb.collection(COLLECTION_NAME).getFullList({
        fields: "Genres",
      });

      const genres = new Set<string>();
      records.forEach((row) => {
        if (Array.isArray(row.Genres)) {
          row.Genres.forEach((g) => genres.add(g));
        }
      });

      return Array.from(genres).sort();
    } catch (error) {
      console.error("Error fetching dynamic genres from PocketBase:", error);
      return [
        "Action",
        "Adventure",
        "Shooter",
        "RPG",
        "Strategy",
        "Simulation",
        "Sports",
        "Racing",
        "Puzzle",
        "Platformer",
        "Horror",
        "Survival",
        "Open World",
      ].sort();
    }
  }

  async scrapeSinglePost(url: string): Promise<FitGirlPost | null> {
    try {
      const record = await pb
        .collection(COLLECTION_NAME)
        .getFirstListItem(`PostLink = "${url}"`);

      if (record) return this.mapRowToPostSync(record);
      return null;
    } catch (error) {
      console.error(
        `Error resolving single post ${url} from PocketBase:`,
        error,
      );
      return null;
    }
  }

  async getPostByID(postId: string): Promise<FitGirlPost | null> {
    try {
      const record = await pb
        .collection(COLLECTION_NAME)
        .getFirstListItem(`PostID = "${postId}"`);

      if (record) return this.mapRowToPostSync(record);
      return null;
    } catch (error) {
      console.error(`Error fetching post ${postId} from PocketBase:`, error);
      return null;
    }
  }

  normalizeTitle(title: string): string {
    let t = title.toLowerCase();

    const romanMap: Record<string, string> = {
      " ii": " 2",
      " iii": " 3",
      " iv": " 4",
      " v": " 5",
      " vi": " 6",
      " vii": " 7",
      " viii": " 8",
      " ix": " 9",
      " x": " 10",
      " xi": " 11",
      " xii": " 12",
      " xiii": " 13",
      " xiv": " 14",
      " xv": " 15",
      " xvi": " 16",
      " xvii": " 17",
      " xviii": " 18",
      " xix": " 19",
      " xx": " 20",
    };

    for (const [rom, dig] of Object.entries(romanMap)) {
      t = t.replace(new RegExp(`${rom}\\b`, "g"), dig);
    }

    return t.replace(/[^a-z0-9\s]/g, "").trim();
  }

  async searchForRepack(gameTitle: string): Promise<FitGirlPost[]> {
    const normalizedSearch = this.normalizeTitle(gameTitle);
    const searchFilter = this.buildSearchFilter(gameTitle);
    if (!searchFilter) return [];

    try {
      const list = await pb.collection(COLLECTION_NAME).getList(1, 100, {
        filter: searchFilter,
      });

      const searchWords = normalizedSearch
        .split(/\s+/)
        .filter((w) => w.length > 2 || /\d/.test(w));

      const allPosts = list.items.map((row) => this.mapRowToPostSync(row));

      const matches: { post: FitGirlPost; score: number }[] = [];

      const extractDigits = (s: string): string[] =>
        (s.match(/\d+/g) || []) as string[];
      const searchDigits = extractDigits(normalizedSearch);

      for (const post of allPosts) {
        if (post.PostTitle.includes("Digest")) continue;

        const normalizedPostTitle = this.normalizeTitle(post.PostTitle);
        const postDigits = extractDigits(normalizedPostTitle);

        let score = 1.0;

        if (searchDigits.length > 0 && postDigits.length > 0) {
          const hasDigitMatch = searchDigits.some((d) =>
            postDigits.includes(d),
          );
          if (!hasDigitMatch) continue;
        }

        let sTitle = normalizedSearch;
        let pTitle = normalizedPostTitle;

        if (sTitle.startsWith("the ")) sTitle = sTitle.substring(4);
        if (pTitle.startsWith("the ")) pTitle = pTitle.substring(4);

        if (pTitle.startsWith(sTitle) || sTitle.startsWith(pTitle)) {
          const longer = pTitle.length > sTitle.length ? pTitle : sTitle;
          const shorter = pTitle.length > sTitle.length ? sTitle : pTitle;
          const remainder = longer.substring(shorter.length).trim();
          const isLikelySame =
            !remainder ||
            /^(v|build|dlc|-|:|edition|collectors|limited|gold|ultimate|deluxe|remastered|remake|definitive|complete|total|goty|game|directors|plus)/i.test(
              remainder,
            );
          score = isLikelySame ? 0.01 : 0.15;

          const wordOverlap =
            sTitle.split(/\s+/).length + (isLikelySame ? 1 : 0);
          score = score / wordOverlap;
        } else {
          const significantSearchWords = searchWords.filter(
            (w: string) => !GENERIC_WORDS.has(w),
          );
          const postWords = normalizedPostTitle
            .split(/\s+/)
            .filter((w: string) => w.length > 2 || /\d/.test(w));
          const significantPostWords = postWords.filter(
            (w: string) => !GENERIC_WORDS.has(w),
          );

          const intersection = significantSearchWords.filter((w) =>
            significantPostWords.includes(w),
          );

          if (significantSearchWords.length > 0) {
            const overlapRatio =
              intersection.length / significantSearchWords.length;
            const strayWords = significantPostWords.filter(
              (w) => !significantSearchWords.includes(w),
            );
            const containsDangerousStray = strayWords.some(
              (w) => !GENERIC_WORDS.has(w) && w.length > 3,
            );

            if (overlapRatio > 0.8 && !containsDangerousStray) {
              score = 0.18;
            } else if (intersection.length === 0) {
              continue;
            } else if (containsDangerousStray) {
              score = 0.5;
            } else if (overlapRatio > 0.5) {
              score = 0.24;
            }
          }

          if (score >= 0.25) {
            if (
              normalizedPostTitle.includes(normalizedSearch) ||
              normalizedSearch.includes(normalizedPostTitle)
            ) {
              const lengthRatio =
                Math.min(normalizedPostTitle.length, normalizedSearch.length) /
                Math.max(normalizedPostTitle.length, normalizedSearch.length);
              if (lengthRatio > 0.6) {
                const baseScore = 1.0 - lengthRatio * 0.9;
                score =
                  score === 0.5 ? Math.max(0.3, baseScore + 0.2) : baseScore;
              }
            } else {
              const distance = this.levenshtein(
                normalizedPostTitle,
                normalizedSearch,
              );
              const baseScore =
                distance /
                Math.max(normalizedPostTitle.length, normalizedSearch.length);
              score =
                score === 0.5 ? Math.max(0.3, baseScore + 0.2) : baseScore;
            }
          }
        }

        if (score < 0.25) {
          matches.push({ post, score });
        }
      }

      matches.sort((a, b) => a.score - b.score);
      return matches.map((m) => m.post);
    } catch (err) {
      console.error("Search failed on pocketbase:", err);
      return [];
    }
  }

  async getIdsOlderThan(timestamp: string): Promise<{ id: string }[]> {
    try {
      const records = await pb.collection(COLLECTION_NAME).getFullList({
        filter: `Timestamp <= "${timestamp}"`,
        fields: "id",
      });

      return records.map((d) => ({ id: d.id }));
    } catch (err) {
      console.error("Error fetching older IDs from PocketBase:", err);
      return [];
    }
  }

  levenshtein(s: string, t: string): number {
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

  /**
   * Optimized atomic toggle for read status
   */
  async toggleReadAtomic(
    userDataId: string,
    repackRecordId: string,
    isRead: boolean,
  ): Promise<void> {
    try {
      await pb.collection("user_data").update(userDataId, {
        [isRead ? "readRepacks+" : "readRepacks-"]: repackRecordId,
      });
    } catch (err) {
      console.error("Failed to toggle read status atomically:", err);
      throw err;
    }
  }

  /**
   * Helper to find the user's userData record
   */
  async getUserDataRecord(): Promise<any> {
    try {
      const user = pb.authStore.model;
      if (!user) return null;
      return await pb
        .collection("user_data")
        .getFirstListItem(`user = "${user.id}"`);
    } catch (err) {
      return null;
    }
  }
}

const instance = new FitGirlService();
export default instance;
