const { collections } = require("./firestoreStore");

async function fixCategories() {
  const fixes = [
    {
      collection: "resources",
      id: "H008x3Q3qiqTQr2VeNOL",
      expectedTitle: "laptops",
      newCategory: "Education"
    },
    {
      collection: "requests",
      id: "DQJhixAObtSBrlX2yOfP",
      expectedTitle: "Laptops",
      newCategory: "Education"
    }
  ];

  for (const fix of fixes) {
    const ref = collections[fix.collection].doc(fix.id);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      throw new Error(`Record not found: ${fix.collection}/${fix.id}`);
    }

    const data = snapshot.data();

    if (
      String(data.title || "").toLowerCase() !==
      fix.expectedTitle.toLowerCase()
    ) {
      throw new Error(`Unexpected title for ${fix.collection}/${fix.id}`);
    }

    if (data.category !== "Food" && data.category !== "Education") {
      throw new Error(
        `Unexpected category "${data.category}" for ${fix.id}; no update made to this record.`
      );
    }
  }

  for (const fix of fixes) {
    const ref = collections[fix.collection].doc(fix.id);
    const snapshot = await ref.get();

    if (snapshot.data().category === "Food") {
      await ref.update({ category: "Education" });
    }

    console.log(
      `Verified ${fix.collection}/${fix.id}: category = Education`
    );
  }

  console.log("Category correction finished.");
  process.exit(0);
}

fixCategories().catch(error => {
  console.error("Category correction failed:", error.message);
  process.exit(1);
});
