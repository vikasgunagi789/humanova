const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const {
  db,
  collections,
  getAll,
  getById,
  create
} = require("./firestoreStore");

const {
  createSecurityMiddleware,
  authRateLimiter
} = require("./security");

const app = express();
const PORT = process.env.PORT || 5000;

// Security and request parsing — register only once.
app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || true
}));

app.use(express.json({ limit: "1mb" }));

// Expose the same Firestore instance to security event handlers.
app.locals.firestore = db;

// Rate-limit authentication endpoints.
app.use("/api/auth", authRateLimiter);

// Public health endpoint; register before protected API middleware.
app.get("/api/health", async (req, res) => {
  try {
    await db.collection("requests").limit(1).get();

    return res.json({
      status: "ok",
      database: "Firestore",
      message: "Humanova API and Firestore are connected."
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    return res.status(503).json({
      status: "error",
      database: "Firestore",
      message: "Firestore is unavailable."
    });
  }
});

// Authenticate the remaining API routes.
// The security middleware must exempt POST /auth/register
// and POST /auth/login from JWT verification.
app.use(
  "/api",
  ...createSecurityMiddleware({
    db,
    jwtSecret: process.env.JWT_SECRET
  })
);

const categories = [
  "Food",
  "Clothing",
  "Education",
  "Medical",
  "Shelter",
  "Transport",
  "Volunteers",
  "Other"
];

const urgencyLevels = ["Low", "Medium", "High", "Critical"];
const requestStatuses = ["Open", "Matched", "Accepted", "Fulfilled"];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validQuantity(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestampMillis(value) {
  if (!value) return null;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function isExpired(resource) {
  if (!resource.availableUntil) return false;

  const expiry = timestampMillis(resource.availableUntil);
  return expiry !== null && expiry < Date.now();
}

function availableStock(resource) {
  return Math.max(0, Number(resource.quantity) || 0);
}

function remainingNeed(request) {
  return Math.max(
    0,
    (Number(request.quantity) || 0) -
    (Number(request.allocatedQuantity) || 0)
  );
}

function calculateMatches(request, resources) {
  const need = remainingNeed(request);

  return resources
    .filter(resource =>
      resource.category === request.category &&
      availableStock(resource) > 0 &&
      !isExpired(resource) &&
      need > 0
    )
    .map(resource => {
      const stock = availableStock(resource);
      const sameLocation =
        cleanString(resource.location).toLowerCase() ===
        cleanString(request.location).toLowerCase();
      const enoughStock = stock >= need;
      const coverage = Math.min(100, Math.round((stock / need) * 100));
      const reasons = [
        `Category match: ${request.category}`,
        sameLocation
          ? `Same location: ${request.location || "location not specified"}`
          : `Different location: ${resource.location || "not specified"}`,
        enoughStock
          ? `Enough stock to cover all ${need} units needed`
          : `Can cover ${Math.min(stock, need)} of ${need} units needed (${coverage}%)`
      ];

      // Transparent rules-based score; this is not a machine-learning prediction.
      const score = Math.min(
        100,
        50 + (sameLocation ? 25 : 0) + (enoughStock ? 25 : Math.round(25 * stock / need))
      );

      return {
        resource: { ...resource, quantity: stock, availableQuantity: stock },
        score,
        reasons,
        availableQuantity: stock,
        suggestedQuantity: Math.min(stock, need),
        coveragePercent: coverage,
        sameLocation,
        enoughStock
      };
    })
    .sort((a, b) => b.score - a.score || b.availableQuantity - a.availableQuantity);
}

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await db.collection("requests").limit(1).get();

    res.json({
      status: "ok",
      database: "Firestore",
      message: "Humanova API and Firestore are connected."
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(503).json({
      status: "error",
      database: "Firestore",
      message: "Firestore is unavailable."
    });
  }
});



// Register a new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;

    if (!name || !email || typeof password !== "string") {
      return res.status(400).json({
        message: "Name, email, and password are required."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address."
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        message: "Password must be between 8 and 128 characters."
      });
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(500).json({
        message: "Authentication is not configured correctly."
      });
    }

    const users = db.collection("users");
    const existing = await users
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(409).json({
        message: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = users.doc();

    await userRef.create({
      name,
      email,
      passwordHash,
      role: "user",
      createdAt: new Date()
    });

    const token = jwt.sign(
      { sub: userRef.id, email, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: { id: userRef.id, name, email, role: "user" }
    });
  } catch (error) {
    console.error("Registration failed:", error.message);
    return res.status(500).json({
      message: "Unable to create your account right now."
    });
  }
});

// Login an existing user

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    const password = req.body?.password;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({
        message: "Email and password are required."
      });
    }

    if (!process.env.JWT_SECRET ||
        process.env.JWT_SECRET.length < 32) {
      console.error("JWT_SECRET is missing or too short.");

      return res.status(500).json({
        message: "Authentication is not configured correctly."
      });
    }

    const snapshot = await db.collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log("Login rejected: no user found for supplied email.");

      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    if (
      typeof user.passwordHash !== "string" ||
      !user.passwordHash.startsWith("$2")
    ) {
      console.error(
        "Login rejected: stored password hash is missing or is not bcrypt."
      );

      return res.status(500).json({
        message:
          "This account uses an unsupported password format. Account recovery is required."
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!validPassword) {
      console.log("Login rejected: password did not match.");

      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      {
        sub: doc.id,
        email: user.email,
        role: user.role || "user"
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: doc.id,
        name: user.name,
        email: user.email,
        role: user.role || "user"
      }
    });
  } catch (error) {
    console.error("Login failed:", error);

    return res.status(500).json({
      message: "Unable to log in right now."
    });
  }
});


// Get the currently logged-in user
app.get("/api/auth/me", async (req, res) => {
  try {
    const userId = req.user?.sub || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    const user = userDoc.data();

    return res.json({
      success: true,
      user: {
        id: userDoc.id,
        name: user.name,
        email: user.email,
        role: user.role || "user"
      }
    });
  } catch (error) {
    console.error("Could not load authenticated user:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load your account."
    });
  }
});


app.get("/api/requests", async (req, res, next) => {
  try {
    const requests = await getAll("requests");
    return res.json(requests);
  } catch (error) {
    next(error);
  }
});


// Create a request
app.post("/api/requests", async (req, res, next) => {
  try {
    const title = cleanString(req.body.title);
    const category = cleanString(req.body.category);
    const location = cleanString(req.body.location);
    const description = cleanString(req.body.description);
    const urgency = req.body.urgency || "Medium";
    const quantity = Number(req.body.quantity);

    if (!title || !location || !category) {
      return res.status(400).json({
        message: "Title, category, and location are required."
      });
    }

    if (!categories.includes(category)) {
      return res.status(400).json({
        message: "Invalid category."
      });
    }

    if (!urgencyLevels.includes(urgency)) {
      return res.status(400).json({
        message: "Invalid urgency level."
      });
    }

    if (!validQuantity(quantity)) {
      return res.status(400).json({
        message: "Quantity must be a positive whole number."
      });
    }

    const request = await create("requests", {
      title,
      description,
      category,
      quantity,
      allocatedQuantity: 0,
      location,
      urgency,
      status: "Open"
    });

    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
});

// Get all resources
app.get("/api/resources", async (req, res, next) => {
  try {
    res.json(await getAll("resources"));
  } catch (error) {
    next(error);
  }
});

// Create a resource
app.post("/api/resources", async (req, res, next) => {
  try {
    const title = cleanString(req.body.title);
    const category = cleanString(req.body.category);
    const location = cleanString(req.body.location);
    const description = cleanString(req.body.description);
    const quantity = Number(req.body.quantity);

    if (!title || !category || !location) {
      return res.status(400).json({
        message: "Title, category, and location are required."
      });
    }

    if (!categories.includes(category)) {
      return res.status(400).json({
        message: "Invalid category."
      });
    }

    if (!validQuantity(quantity)) {
      return res.status(400).json({
        message: "Quantity must be a positive whole number."
      });
    }

    let availableUntil = null;

    if (req.body.availableUntil) {
      const expiry = new Date(req.body.availableUntil);

      if (Number.isNaN(expiry.getTime())) {
        return res.status(400).json({
          message: "Invalid availableUntil date."
        });
      }

      availableUntil = expiry;
    }

    const resource = await create("resources", {
      title,
      description,
      category,
      quantity,
      location,
      availableUntil
    });

    res.status(201).json(resource);
  } catch (error) {
    next(error);
  }
});

// Find matching resources for a request
app.get("/api/matches/:requestId", async (req, res, next) => {
  try {
    const request = await getById(
      "requests",
      req.params.requestId
    );

    if (!request) {
      return res.status(404).json({
        message: "Request not found."
      });
    }

    const resources = await getAll("resources");
    const matches = calculateMatches(request, resources);

    res.json({
      request,
      remainingNeed: remainingNeed(request),
      matches
    });
  } catch (error) {
    next(error);
  }
});

// AI-assisted Smart Matching.
// Place after GET /api/matches/:requestId.
// Keep the existing matching endpoint unchanged.

app.get("/api/ai/matches/:requestId", async (req, res) => {
  try {
    const request = await getById("requests", req.params.requestId);

    if (!request) {
      return res.status(404).json({ message: "Request not found." });
    }

    const resources = await getAll("resources");
    const baseMatches = calculateMatches(request, resources);

    // Only resources already approved by the existing rules
    // are candidates for AI ranking.
    if (!baseMatches.length) {
      return res.json({
        request,
        matches: [],
        aiEnhanced: false,
        message: "No eligible resources currently match this request."
      });
    }

    // Fall back to normal matching if AI is not configured.
    if (!process.env.GROQ_API_KEY) {
      return res.json({
        request,
        matches: baseMatches,
        aiEnhanced: false
      });
    }

    const getResourceId = (match) =>
      String(
        match.resource?.id ??
        match.resource?._id ??
        match.resource?.resourceId ??
        ""
      );

    const candidates = baseMatches.map((match) => ({
      resourceId: getResourceId(match),
      name: match.resource?.name || match.resource?.title || "Unnamed resource",
      category: match.resource?.category || "",
      location: match.resource?.location || "",
      availableQuantity: match.availableQuantity,
      suggestedQuantity: match.suggestedQuantity,
      score: match.score,
      reasons: match.reasons || []
    }));

    // Do not ask AI to rank candidates without stable IDs.
    if (candidates.some((item) => !item.resourceId)) {
      return res.json({
        request,
        matches: baseMatches,
        aiEnhanced: false
      });
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0.1,
          max_tokens: 1000,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You rank eligible community resources for a request.
Return valid JSON: {"rankedMatches":[{"resourceId":"exact ID","reason":"short explanation"}]}.
Only use the supplied candidates and their IDs. Do not invent stock,
distance, expiry, delivery times, or availability. Consider urgency,
location, quantity fit, and the supplied rule-based reasons.
Do not change quantities or allocate resources.`
            },
            {
              role: "user",
              content: JSON.stringify({
                request: {
                  title: request.title,
                  description: request.description || "",
                  category: request.category,
                  quantity: request.quantity,
                  allocatedQuantity: request.allocatedQuantity || 0,
                  urgency: request.urgency,
                  location: request.location
                },
                candidates
              })
            }
          ]
        })
      }
    );

    if (!response.ok) {
      console.error("AI matching provider status:", response.status);

      return res.json({
        request,
        matches: baseMatches,
        aiEnhanced: false
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.json({
        request,
        matches: baseMatches,
        aiEnhanced: false
      });
    }

    const parsed = JSON.parse(content);
    const rankedMatches = Array.isArray(parsed.rankedMatches)
      ? parsed.rankedMatches
      : [];

    const allowedIds = new Set(candidates.map((item) => item.resourceId));
    const rankMap = new Map();

    for (const item of rankedMatches) {
      if (
        item &&
        allowedIds.has(String(item.resourceId)) &&
        typeof item.reason === "string" &&
        !rankMap.has(String(item.resourceId))
      ) {
        rankMap.set(String(item.resourceId), item.reason.slice(0, 400));
      }
    }

    // Only reorder real, rule-approved matches.
    // Unranked matches remain available at the end.
    const enrichedMatches = [...baseMatches].sort((a, b) => {
      const aId = getResourceId(a);
      const bId = getResourceId(b);
      return (
        (rankMap.has(bId) ? 1 : 0) -
        (rankMap.has(aId) ? 1 : 0)
      );
    }).map((match) => ({
      ...match,
      aiReason: rankMap.get(getResourceId(match)) || null
    }));

    return res.json({
      request,
      matches: enrichedMatches,
      aiEnhanced: rankMap.size > 0
    });
  } catch (error) {
    console.error("AI Smart Matching failed:", error.message);

    // Preserve functionality if AI fails.
    try {
      const request = await getById("requests", req.params.requestId);
      if (!request) {
        return res.status(404).json({ message: "Request not found." });
      }

      const resources = await getAll("resources");

      return res.json({
        request,
        matches: calculateMatches(request, resources),
        aiEnhanced: false
      });
    } catch (fallbackError) {
      console.error("Smart Matching fallback failed:", fallbackError.message);
      return res.status(500).json({
        message: "Unable to load resource matches."
      });
    }
  }
});


app.post("/api/ai/analyze-need", async (req, res) => {
  try {
    const { title, description, category, quantity, location } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        message: "AI is not configured. Add GROQ_API_KEY to server/.env."
      });
    }

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 100 ||
      (description != null &&
        (typeof description !== "string" || description.length > 500))
    ) {
      return res.status(400).json({
        message: "Enter a valid title and description."
      });
    }

    const validCategories = [
      "Food",
      "Clothing",
      "Education",
      "Medical",
      "Shelter",
      "Transport",
      "Volunteers",
      "Other"
    ];

    const validUrgencies = ["Low", "Medium", "High", "Critical"];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are Humanova's community needs analysis engine.

Analyze the submitted request and return valid JSON with:
{
  "summary": "Short summary of the need",
  "suggestedCategory": "One valid category",
  "suggestedUrgency": "Low, Medium, High, or Critical",
  "reason": "Evidence-based explanation",
  "missingInformation": ["Questions that need clarification"],
  "suggestedActions": ["Practical next steps"]
}

Valid categories: ${validCategories.join(", ")}.
Valid urgency levels: ${validUrgencies.join(", ")}.

Never invent facts or claim that resources are available.
Use Critical only when the supplied details indicate an
immediate, serious need. If evidence is insufficient,
choose a cautious recommendation and explain uncertainty.
Suggestions must be reviewed by a human.
Do not change database records or allocate resources.`
            },
            {
              role: "user",
              content: JSON.stringify({
                title: title.trim(),
                description: description || "",
                category: category || "Other",
                quantity: quantity ?? null,
                location: location || "Not provided"
              })
            }
          ]
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
  console.error("Groq API error:", {
    status: response.status,
    message: data.error?.message || "No error details returned"
  });

  let message = "AI analysis failed. Please try again.";

  if (response.status === 401) {
    message = "Groq API key is invalid. Check server/.env.";
  } else if (response.status === 403) {
    message = "Groq denied access. Check your model permissions.";
  } else if (response.status === 429) {
    message = "Groq rate limit or quota reached. Try again later.";
  } else if (response.status === 400 || response.status === 404) {
    message = "Groq rejected the model or request configuration.";
  }

  return res.status(502).json({ message });
}

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({
        message: "The AI returned an empty response."
      });
    }

    let analysis;

    try {
      analysis = JSON.parse(content);
    } catch {
      return res.status(502).json({
        message: "The AI returned an invalid response."
      });
    }

    if (
      typeof analysis.summary !== "string" ||
      !validCategories.includes(analysis.suggestedCategory) ||
      !validUrgencies.includes(analysis.suggestedUrgency) ||
      typeof analysis.reason !== "string" ||
      !Array.isArray(analysis.missingInformation) ||
      !Array.isArray(analysis.suggestedActions)
    ) {
      return res.status(502).json({
        message: "The AI response failed validation."
      });
    }

    res.json({
      success: true,
      analysis: {
        summary: analysis.summary,
        suggestedCategory: analysis.suggestedCategory,
        suggestedUrgency: analysis.suggestedUrgency,
        reason: analysis.reason,
        missingInformation: analysis.missingInformation
          .filter(item => typeof item === "string")
          .slice(0, 6),
        suggestedActions: analysis.suggestedActions
          .filter(item => typeof item === "string")
          .slice(0, 6)
      }
    });
  } catch (error) {
    console.error("Humanova AI analysis failed:", error.message);

    res.status(500).json({
      message: "Unable to analyze this request right now."
    });
  }
});


// Update request status
app.patch("/api/requests/:id/status", async (req, res, next) => {
  try {
    const status = cleanString(req.body.status);

    if (!requestStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid request status."
      });
    }

    const requestRef = collections.requests.doc(req.params.id);

    const result = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(requestRef);

      if (!snapshot.exists) {
        const error = new Error("Request not found.");
        error.statusCode = 404;
        throw error;
      }

      const request = snapshot.data();

      if (
        status === "Fulfilled" &&
        Number(request.allocatedQuantity || 0) <
          Number(request.quantity || 0)
      ) {
        const error = new Error(
          "A request cannot be marked fulfilled until its full quantity is allocated."
        );
        error.statusCode = 409;
        throw error;
      }

      transaction.update(requestRef, { status });

      return {
        ...request,
        status,
        _id: snapshot.id
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Allocate a resource to a request.
// This is the ONLY allocation POST handler.
app.post("/api/allocations", async (req, res, next) => {
  try {
    const requestId = cleanString(req.body.requestId);
    const resourceId = cleanString(req.body.resourceId);
    const quantity = Number(req.body.quantity);

    if (!requestId || !resourceId) {
      return res.status(400).json({
        message: "requestId and resourceId are required."
      });
    }

    if (!validQuantity(quantity)) {
      return res.status(400).json({
        message: "Allocation quantity must be a positive whole number."
      });
    }

    const requestRef = collections.requests.doc(requestId);
    const resourceRef = collections.resources.doc(resourceId);
    const allocationRef = collections.allocations.doc();

    const allocation = await db.runTransaction(
      async transaction => {
        // All reads must happen before any writes.
        const [requestSnapshot, resourceSnapshot] =
          await Promise.all([
            transaction.get(requestRef),
            transaction.get(resourceRef)
          ]);

        if (!requestSnapshot.exists) {
          const error = new Error("Request not found.");
          error.statusCode = 404;
          throw error;
        }

        if (!resourceSnapshot.exists) {
          const error = new Error("Resource not found.");
          error.statusCode = 404;
          throw error;
        }

        const request = requestSnapshot.data();
        const resource = resourceSnapshot.data();

        if (!["Open", "Matched", "Accepted"].includes(request.status)) {
          const error = new Error(
            "Only Open or Matched requests can receive allocations."
          );
          error.statusCode = 409;
          throw error;
        }

        if (request.category !== resource.category) {
          const error = new Error(
            "Resource and request categories must match."
          );
          error.statusCode = 400;
          throw error;
        }

        if (isExpired(resource)) {
          const error = new Error(
            "This resource has expired and cannot be allocated."
          );
          error.statusCode = 409;
          throw error;
        }

        const stock = availableStock(resource);
        const need = remainingNeed(request);

        if (quantity > stock) {
          const error = new Error(
            `Insufficient stock. Available quantity: ${stock}.`
          );
          error.statusCode = 409;
          throw error;
        }

        if (quantity > need) {
          const error = new Error(
            `Allocation exceeds remaining need. Remaining need: ${need}.`
          );
          error.statusCode = 409;
          throw error;
        }

        const newStock = stock - quantity;
        const newAllocated =
          Number(request.allocatedQuantity || 0) + quantity;
        const currentStatus = request.status || "Open";

const isFullyAllocated =
  newAllocated >= Number(request.quantity || 0);

const newStatus =
  currentStatus === "Accepted"
    ? "Accepted"
    : currentStatus === "Fulfilled"
      ? "Fulfilled"
      : isFullyAllocated
        ? "Matched"
        : "Open";

        const createdAt = new Date();

        const allocationData = {
          requestId,
          resourceId,
          requestTitle: request.title,
          resourceTitle: resource.title,
          quantity,
          location: request.location || resource.location || "",
          status: "Reserved",
          createdAt
        };

        // The following writes commit together or not at all.
        transaction.update(resourceRef, {
          quantity: newStock
        });

        transaction.update(requestRef, {
          allocatedQuantity: newAllocated,
          status: newStatus
        });

        transaction.set(allocationRef, allocationData);

        return {
          ...allocationData,
          _id: allocationRef.id,
          remainingNeed: Math.max(
  0,
  Number(request.quantity || 0) - newAllocated
),
          remainingStock: newStock,
          requestStatus: newStatus
        };
      }
    );

    res.status(201).json(allocation);
  } catch (error) {
    next(error);
  }
});

// Get all allocations
app.get("/api/allocations", async (req, res, next) => {
  try {
    res.json(await getAll("allocations"));
  } catch (error) {
    next(error);
  }
});



app.patch("/api/allocations/:id/cancel", async (req, res) => {
  const { db } = require("./firebase");
  const allocationId = req.params.id;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const allocationRef = db.collection("allocations").doc(allocationId);
      const allocationSnap = await transaction.get(allocationRef);

      if (!allocationSnap.exists) {
        const error = new Error("Allocation not found.");
        error.statusCode = 404;
        throw error;
      }

      const allocation = allocationSnap.data();

      if (allocation.status !== "Reserved") {
        const error = new Error(
          `Cannot cancel an allocation with status ${allocation.status}.`
        );
        error.statusCode = 409;
        throw error;
      }

      const quantity = Number(allocation.quantity);

      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        const error = new Error("Invalid allocation quantity.");
        error.statusCode = 409;
        throw error;
      }

      const resourceRef = db.collection("resources").doc(allocation.resourceId);
      const requestRef = db.collection("requests").doc(allocation.requestId);

      // Read every document before making transaction writes.
      const [resourceSnap, requestSnap] = await Promise.all([
        transaction.get(resourceRef),
        transaction.get(requestRef)
      ]);

      if (!resourceSnap.exists || !requestSnap.exists) {
        const error = new Error(
          "Related resource or request was not found. No changes were made."
        );
        error.statusCode = 409;
        throw error;
      }

      const resource = resourceSnap.data();
      const request = requestSnap.data();

      const stock = Number(resource.quantity);
      const allocated = Number(request.allocatedQuantity ?? 0);
      const requested = Number(request.quantity);

      if (
        !Number.isSafeInteger(stock) ||
        stock < 0 ||
        !Number.isSafeInteger(allocated) ||
        allocated < quantity ||
        !Number.isSafeInteger(requested) ||
        requested < 1 ||
        requested < allocated
      ) {
        const error = new Error(
          "Invalid stock or allocation totals. No changes were made."
        );
        error.statusCode = 409;
        throw error;
      }

      // Restore resource stock.
      const restoredStock = stock + quantity;

      if (!Number.isSafeInteger(restoredStock)) {
        const error = new Error("Restored stock exceeds the valid quantity limit.");
        error.statusCode = 409;
        throw error;
      }

      transaction.update(resourceRef, {
        quantity: restoredStock
      });

      // Release the cancelled allocation quantity.
      const remainingAllocated = allocated - quantity;
      const currentStatus = request.status || "Open";

      // Recalculate status without incorrectly matching partial allocations.
      let restoredStatus;

      if (currentStatus === "Accepted") {
        restoredStatus = "Accepted";
      } else if (remainingAllocated >= requested) {
        restoredStatus =
          currentStatus === "Fulfilled" ? "Fulfilled" : "Matched";
      } else {
        restoredStatus = "Open";
      }

      transaction.update(requestRef, {
        allocatedQuantity: remainingAllocated,
        status: restoredStatus
      });

      transaction.update(allocationRef, {
        status: "Cancelled",
        cancelledAt: new Date()
      });

      return {
        allocationId,
        restoredQuantity: quantity,
        remainingStock: restoredStock,
        remainingAllocated,
        requestStatus: restoredStatus
      };
    });

    return res.json({
      success: true,
      message: "Allocation cancelled and quantities restored.",
      ...result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    console.error("Allocation cancellation failed:", error);

    return res.status(500).json({
      error: "Unable to cancel allocation. Check backend logs."
    });
  }
});



// Emergency priority report
app.get("/api/emergency", async (req, res, next) => {
  try {
    const [requests, resources] = await Promise.all([
      getAll("requests"),
      getAll("resources")
    ]);

    // Local stock ledger prevents the report from counting
    // the same available stock toward multiple requests.
    const stockLedger = new Map(
      resources.map(resource => [
        resource._id,
        isExpired(resource) ? 0 : availableStock(resource)
      ])
    );

    const urgencyWeight = {
      Critical: 4,
      High: 3,
      Medium: 2,
      Low: 1
    };

    const priorityRequests = requests
      .filter(request => remainingNeed(request) > 0)
      .map(request => {
        const urgency = urgencyWeight[request.urgency] || 1;
        const need = remainingNeed(request);

        return {
          ...request,
          remainingNeed: need,
          priorityScore: urgency * 100 + Math.min(need, 99)
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);

    const ranked = priorityRequests.map(request => {
      let availableQuantity = 0;
      let remainingShortage = remainingNeed(request);

      const matchingResources = resources
        .filter(resource =>
          resource.category === request.category &&
          !isExpired(resource) &&
          (stockLedger.get(resource._id) || 0) > 0
        )
        .sort((a, b) => {
          const aSame =
            cleanString(a.location).toLowerCase() ===
            cleanString(request.location).toLowerCase();
          const bSame =
            cleanString(b.location).toLowerCase() ===
            cleanString(request.location).toLowerCase();

          return Number(bSame) - Number(aSame);
        })
        .map(resource => {
          const stock = stockLedger.get(resource._id) || 0;
          const used = Math.min(stock, remainingShortage);

          stockLedger.set(resource._id, stock - used);
          availableQuantity += used;
          remainingShortage -= used;

          return {
            ...resource,
            availableQuantity: stock,
            suggestedQuantity: used
          };
        })
        .filter(resource => resource.suggestedQuantity > 0);

      const need = remainingNeed(request);
      const coveragePercent = need > 0
        ? Math.round((availableQuantity / need) * 100)
        : 100;

      return {
        ...request,
        availableQuantity,
        shortage: Math.max(0, need - availableQuantity),
        coveragePercent,
        coverageStatus:
          availableQuantity >= need
            ? "Covered"
            : availableQuantity > 0
              ? "Partially Covered"
              : "Uncovered",
        matchingResources
      };
    });

    res.json({
      summary: {
        totalRequests: ranked.length,
        criticalRequests: ranked.filter(
          item => item.urgency === "Critical"
        ).length,
        uncoveredRequests: ranked.filter(
          item => item.coverageStatus === "Uncovered"
        ).length,
        partiallyCoveredRequests: ranked.filter(
          item => item.coverageStatus === "Partially Covered"
        ).length
      },
      requests: ranked
    });
  } catch (error) {
    next(error);
  }
});

// Central error handler
app.use((error, req, res, next) => {
  console.error("API error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.statusCode || 500).json({
    message:
      error.statusCode && error.statusCode < 500
        ? error.message
        : "An internal server error occurred."
  });
});

// Do not start a fake in-memory database if Firestore fails.
async function start() {
  try {
    await db.collection("requests").limit(1).get();

    app.listen(PORT, () => {
      console.log(`Humanova API running at http://localhost:${PORT}`);
      console.log("Database: Firebase Firestore");
    });
  } catch (error) {
    console.error("Could not connect to Firestore:", error.message);
    process.exit(1);
  }
}

start();