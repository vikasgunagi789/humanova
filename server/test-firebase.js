
const { db } = require("./firebase");
const { getApp } = require("firebase-admin/app");

async function testConnection() {
  try {
    await db.collection("_connection_test").limit(1).get();
    console.log("Firebase Firestore connection successful.");
  } catch (error) {
    console.error("Firebase connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await getApp().delete();
  }
}

testConnection();
