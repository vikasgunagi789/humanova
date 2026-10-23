
const {
  getAll,
  collections
} = require("./firestoreStore");

async function testStore() {
  try {
    const requests = await getAll("requests");

    console.log("Firestore store is working.");
    console.log("Existing requests:", requests.length);
  } catch (error) {
    console.error("Store test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await require("firebase-admin/app").getApp().delete();
  }
}

testStore();
