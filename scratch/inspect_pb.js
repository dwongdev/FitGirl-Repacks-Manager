const PocketBase = require("pocketbase/cjs");
const pb = new PocketBase("http://pocketbase-z0s00ww840s0g0sow8s8kk84.93.127.186.247.sslip.io");

async function test() {
  try {
    await pb.admins.authWithPassword("aboodalsa0@gmail.com", "14725zaqxs");
    console.log("✅ Admin Auth Success");

    const targetUserId = "623yc4yp2utmll7";
    console.log(`\n👤 Testing create for user: ${targetUserId}`);

    const payload = {
      user: targetUserId,
      userGames: {},
      statusTimestamps: {},
      readRepacks: [],
      repackIgdbMapping: {},
      virtualGames: {},
      gamePaths: {},
      gameDs4Settings: {},
      playTime: {},
      lastPlayedTimestamps: {},
      activeDownloads: {},
      downloadedGames: {},
      settings: {},
      migrationVersion: 1,
    };

    const record = await pb.collection("user_data").create(payload);
    console.log("✅ Success! Created record:", record.id);
    await pb.collection("user_data").delete(record.id);
    console.log("🗑️ Deleted.");

  } catch (e) {
    console.error("❌ Failed!");
    console.error(e.message);
    if (e.data) console.error(JSON.stringify(e.data, null, 2));
  }
}

test();
