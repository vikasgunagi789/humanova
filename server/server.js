
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const categories = [
  "Food", "Clothing", "Education", "Medical",
  "Shelter", "Transport", "Volunteers", "Other"
];

const urgencyLevels = ["Low", "Medium", "High", "Critical"];
const statuses = ["Open", "Matched", "Accepted", "Fulfilled"];

const requestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  category: { type: String, enum: categories, required: true },
  quantity: { type: Number, min: 1, required: true },
  location: { type: String, required: true },
  urgency: { type: String, enum: urgencyLevels, default: "Medium" },
  status: { type: String, enum: statuses, default: "Open" },
  createdAt: { type: Date, default: Date.now }
});

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  category: { type: String, enum: categories, required: true },
  quantity: { type: Number, min: 1, required: true },
  location: { type: String, required: true },
  availableUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Request = mongoose.model("Request", requestSchema);
const Resource = mongoose.model("Resource", resourceSchema);

// Demo mode works without a MongoDB connection.
let useMongo = false;
let requests = [];
let resources = [];

function cleanText(value, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validateItem(body, isRequest) {
  const title = cleanText(body.title, 100);
  const location = cleanText(body.location, 100);
  const category = body.category;
  const quantity = Number(body.quantity);

  if (!title || !location || !categories.includes(category)) {
    return "Title, valid category, and location are required.";
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    return "Quantity must be a positive whole number.";
  }

  if (isRequest && !urgencyLevels.includes(body.urgency || "Medium")) {
    return "Invalid urgency level.";
  }

  return null;
}

async function allRequests() {
  return useMongo
    ? Request.find().sort({ createdAt: -1 }).lean()
    : requests;
}

async function allResources() {
  return useMongo
    ? Resource.find().sort({ createdAt: -1 }).lean()
    : resources;
}

async function findRequest(id) {
  if (useMongo) {
    if (!mongoose.isValidObjectId(id)) return null;
    return Request.findById(id);
  }
  return requests.find(item => item._id === id) || null;
}

async function updateRequest(id, updates) {
  if (useMongo) {
    if (!mongoose.isValidObjectId(id)) return null;
    return Request.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });
  }

  const item = requests.find(item => item._id === id);
  if (!item) return null;
  Object.assign(item, updates);
  return item;
}

const urgencyScore = {
  Low: 25,
  Medium: 50,
  High: 75,
  Critical: 100
};

function calculateMatches(request, availableResources) {
  return availableResources
    .filter(resource => {
      const open = request.status === "Open";
      const correctCategory = resource.category === request.category;
      const enoughQuantity = resource.quantity > 0;
      return open && correctCategory && enoughQuantity;
    })
    .map(resource => {
      const sameLocation =
        resource.location.trim().toLowerCase() ===
        request.location.trim().toLowerCase();

      const quantityRatio = Math.min(
        resource.quantity / request.quantity, 1
      );

      const score = Math.round(
        40 +
        (sameLocation ? 25 : 0) +
        urgencyScore[request.urgency] * 0.20 +
        quantityRatio * 15
      );

      const reasons = [
        "Same resource category",
        sameLocation ? "Same locality" : "Different locality",
        resource.quantity >= request.quantity
          ? "Quantity is sufficient"
          : "Partial quantity available",
        `${request.urgency} urgency considered`
      ];

      return {
        resource,
        score: Math.min(score, 100),
        reasons
      };
    })
    .sort((a, b) => b.score - a.score);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: useMongo ? "MongoDB" : "Demo memory mode"
  });
});

app.get("/api/dashboard", async (req, res, next) => {
  try {
    const [rs, inventory] = await Promise.all([
      allRequests(), allResources()
    ]);

    res.json({
      totalRequests: rs.length,
      openRequests: rs.filter(r => r.status === "Open").length,
      fulfilled: rs.filter(r => r.status === "Fulfilled").length,
      availableResources: inventory.reduce(
        (sum, r) => sum + r.quantity, 0
      ),
      urgentRequests: rs.filter(
        r => ["High", "Critical"].includes(r.urgency) &&
          r.status !== "Fulfilled"
      ).length
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/requests", async (req, res, next) => {
  try {
    res.json(await allRequests());
  } catch (err) {
    next(err);
  }
});

app.post("/api/requests", async (req, res, next) => {
  try {
    const error = validateItem(req.body, true);
    if (error) return res.status(400).json({ error });

    const item = {
      title: cleanText(req.body.title, 100),
      description: cleanText(req.body.description, 500),
      category: req.body.category,
      quantity: Number(req.body.quantity),
      location: cleanText(req.body.location, 100),
      urgency: req.body.urgency || "Medium",
      status: "Open",
      createdAt: new Date()
    };

    const saved = useMongo
      ? await Request.create(item)
      : { ...item, _id: require("crypto").randomUUID() };

    if (!useMongo) requests.unshift(saved);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

app.get("/api/resources", async (req, res, next) => {
  try {
    res.json(await allResources());
  } catch (err) {
    next(err);
  }
});

app.post("/api/resources", async (req, res, next) => {
  try {
    const error = validateItem(req.body, false);
    if (error) return res.status(400).json({ error });

    const item = {
      title: cleanText(req.body.title, 100),
      description: cleanText(req.body.description, 500),
      category: req.body.category,
      quantity: Number(req.body.quantity),
      location: cleanText(req.body.location, 100),
      createdAt: new Date()
    };

    const saved = useMongo
      ? await Resource.create(item)
      : { ...item, _id: require("crypto").randomUUID() };

    if (!useMongo) resources.unshift(saved);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

app.get("/api/matches/:requestId", async (req, res, next) => {
  try {
    const request = await findRequest(req.params.requestId);
    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }

    const inventory = await allResources();
    res.json({
      request,
      matches: calculateMatches(request, inventory)
    });
  } catch (err) {
    next(err);
  }
});

app.patch("/api/requests/:id/status", async (req, res, next) => {
  try {
    const allowedTransitions = {
      Open: ["Matched"],
      Matched: ["Accepted", "Open"],
      Accepted: ["Fulfilled", "Open"],
      Fulfilled: []
    };

    const request = await findRequest(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }

    const nextStatus = req.body.status;
    if (!statuses.includes(nextStatus) ||
        !allowedTransitions[request.status].includes(nextStatus)) {
      return res.status(400).json({
        error: `Cannot change ${request.status} to ${nextStatus}.`
      });
    }

    const updated = await updateRequest(req.params.id, {
      status: nextStatus
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error. Check backend logs." });
});


async function start() {
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000
      });
      useMongo = true;
      console.log("Connected to MongoDB");
    } catch (err) {
      console.error("MongoDB connection failed:", err.message);
      console.log("Starting in temporary demo memory mode.");
    }
  }

  if (!useMongo && requests.length === 0 && resources.length === 0) {
    const { randomUUID } = require("crypto");

    requests = [
      {
        _id: randomUUID(),
        title: "Meal packets for a community event",
        description: "Meals needed for local families.",
        category: "Food",
        quantity: 20,
        location: "Kadwad",
        urgency: "Critical",
        status: "Open",
        createdAt: new Date()
      },
      {
        _id: randomUUID(),
        title: "School textbooks for students",
        description: "Books for students who need learning materials.",
        category: "Education",
        quantity: 10,
        location: "Karwar",
        urgency: "High",
        status: "Open",
        createdAt: new Date()
      },
      {
        _id: randomUUID(),
        title: "Blankets for a community shelter",
        description: "Blankets for shelter residents.",
        category: "Shelter",
        quantity: 5,
        location: "Kadwad",
        urgency: "Medium",
        status: "Open",
        createdAt: new Date()
      }
    ];

    resources = [
      {
        _id: randomUUID(),
        title: "Freshly prepared meal packets",
        description: "Available meal packets for community distribution.",
        category: "Food",
        quantity: 25,
        location: "Kadwad",
        createdAt: new Date()
      },
      {
        _id: randomUUID(),
        title: "Unused school textbooks",
        description: "A collection of textbooks available for donation.",
        category: "Education",
        quantity: 8,
        location: "Karwar",
        createdAt: new Date()
      },
      {
        _id: randomUUID(),
        title: "Warm blankets",
        description: "Clean blankets available for community use.",
        category: "Shelter",
        quantity: 10,
        location: "Kadwad",
        createdAt: new Date()
      },
      {
        _id: randomUUID(),
        title: "Extra packaged meals",
        description: "Additional meal packets from a local donor.",
        category: "Food",
        quantity: 10,
        location: "Karwar",
        createdAt: new Date()
      }
    ];

    console.log("Demo requests and resources loaded.");
  }

  app.listen(process.env.PORT || 5000, () => {
    console.log("Humanova API running at http://localhost:5000");
  });
}

start();
