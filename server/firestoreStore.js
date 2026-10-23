
const { db } = require("./firebase");

const collections = {
  requests: db.collection("requests"),
  resources: db.collection("resources"),
  allocations: db.collection("allocations")
};

async function getAll(collectionName) {
  const collection = collections[collectionName];

  if (!collection) {
    throw new Error("Unknown Firestore collection.");
  }

  const snapshot = await collection
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map(doc => ({
    ...doc.data(),
    _id: doc.id
  }));
}

async function getById(collectionName, id) {
  const collection = collections[collectionName];

  if (!collection) {
    throw new Error("Unknown Firestore collection.");
  }

  const doc = await collection.doc(id).get();

  if (!doc.exists) {
    return null;
  }

  return {
    ...doc.data(),
    _id: doc.id
  };
}

async function create(collectionName, data) {
  const collection = collections[collectionName];

  if (!collection) {
    throw new Error("Unknown Firestore collection.");
  }

  const docRef = await collection.add({
    ...data,
    createdAt: new Date()
  });

  const saved = await docRef.get();

  return {
    ...saved.data(),
    _id: saved.id
  };
}

module.exports = {
  db,
  collections,
  getAll,
  getById,
  create
};
