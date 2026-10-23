
const path = require("path");
const {
  initializeApp,
  getApps,
  cert
} = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require(
  path.join(__dirname, "firebase-service-account.json")
);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

module.exports = { db };
