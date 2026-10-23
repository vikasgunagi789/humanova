
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const {
  db,
  collections,
  getAll,
  getById,
  create
} = require("./firestoreStore");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
  return resources
    .filter(resource => {
      return (
        resource.category === request.category &&
        availableStock(resource) > 0 &&
        !isExpired(resource)
      );
    })
    .map(resource => {
      let score = 50;

      if (
        cleanString(resource.location).toLowerCase() ===
        cleanString(request.location).toLowerCase()
      ) {
        score += 30;
      }

      if (availableStock(resource) >= remainingNeed(request)) {
        score += 20;
      } else {
        score += Math.round(
          20 * availableStock(resource) /
          Math.max(1, remainingNeed(request))
        );
      }

      return {
        ...resource,
        availableQuantity: availableStock(resource),
        matchScore: Math.min(100, score)
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
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

// Dashboard
app.get("/api/dashboard", async (req, res, next) => {
  try {
    const [requests, resources, allocations] = await Promise.all([
      getAll("requests"),
      getAll("resources"),
      getAll("allocations")
    ]);

    res.json({
      totalRequests: requests.length,
      openRequests: requests.filter(
        item => item.status === "Open"
      ).length,
      matchedRequests: requests.filter(
        item => item.status === "Matched"
      ).length,
      fulfilledRequests: requests.filter(
        item => item.status === "Fulfilled"
      ).length,
      totalResources: resources.length,
      availableResources: resources.filter(
        item => availableStock(item) > 0 && !isExpired(item)
      ).length,
      totalAllocations: allocations.length,
      requests,
      resources,
      allocations
    });
  } catch (error) {
    next(error);
  }
});

// Get all requests
app.get("/api/requests", async (req, res, next) => {
  try {
    res.json(await getAll("requests"));
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

        if (!["Open", "Matched"].includes(request.status)) {
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
        const newStatus =
          newAllocated >= Number(request.quantity)
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
          remainingNeed: Number(request.quantity) - newAllocated,
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
        !Number.isSafeInteger(stock) || stock < 0 ||
        !Number.isSafeInteger(allocated) || allocated < quantity ||
        !Number.isSafeInteger(requested) || requested < allocated
      ) {
        const error = new Error(
          "Invalid stock or allocation totals. No changes were made."
        );
        error.statusCode = 409;
        throw error;
      }

      // Restore the resource and release the request quantity.
      transaction.update(resourceRef, {
        quantity: stock + quantity
      });

      transaction.update(requestRef, {
        allocatedQuantity: allocated - quantity,
        status: "Open"
      });

      transaction.update(allocationRef, {
        status: "Cancelled",
        cancelledAt: new Date()
      });

      return {
        allocationId,
        restoredQuantity: quantity,
        remainingStock: stock + quantity,
        remainingAllocated: allocated - quantity
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
