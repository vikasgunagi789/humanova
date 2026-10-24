
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");

function writeSecurityEvent(db, event) {
  // Logging failures must not crash the main API.
  if (!db) return;

  db.collection("securityEvents")
    .add({
      ...event,
      createdAt: new Date().toISOString(),
    })
    .catch((error) => {
      console.error("Could not save security event:", error.message);
    });
}

const authRateLimiter = rateLimit({
  windowMs: 150000000 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many authentication attempts. Try again in 15 minutes.",
  },
  handler: (req, res, next, options) => {
    writeSecurityEvent(req.app.locals.firestore, {
      type: "AUTH_RATE_LIMIT",
      severity: "HIGH",
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      path: req.originalUrl,
      details: "Authentication rate limit exceeded",
    });

    res.status(options.statusCode).json(options.message);
  },
});

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    writeSecurityEvent(req.app.locals.firestore, {
      type: "API_RATE_LIMIT",
      severity: "MEDIUM",
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      path: req.originalUrl,
      details: "API request rate limit exceeded",
    });

    res.status(options.statusCode).json({
      message: "Too many requests. Please slow down.",
    });
  },
});

function createSecurityMiddleware({ db, jwtSecret }) {
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is missing. Set it in server/.env.");
  }

  return [
    (req, res, next) => {
      // Make the Firestore logger available to rate-limit handlers.
      req.app.locals.firestore = db;
      next();
    },

    apiRateLimiter,

    (req, res, next) => {
      // Registration and login must remain accessible without a token.
      const publicAuthRoutes = [
        "/auth/register",
        "/auth/login",
      ];

      if (
        req.method === "POST" &&
        publicAuthRoutes.includes(req.path)
      ) {
        return next();
      }

      const authorization = req.get("authorization") || "";
      const [scheme, token] = authorization.split(" ");

      if (scheme !== "Bearer" || !token) {
        writeSecurityEvent(db, {
          type: "AUTH_REQUIRED",
          severity: "MEDIUM",
          ip: req.ip,
          userAgent: req.get("user-agent") || "unknown",
          path: req.originalUrl,
          method: req.method,
          details: "Protected API requested without a bearer token",
        });

        return res.status(401).json({
          message: "Authentication required. Please sign in.",
        });
      }

      try {
        const decoded = jwt.verify(token, jwtSecret, {
          algorithms: ["HS256"],
        });

        req.user = decoded;
        return next();
      } catch (error) {
        writeSecurityEvent(db, {
          type: "INVALID_TOKEN",
          severity: "HIGH",
          ip: req.ip,
          userAgent: req.get("user-agent") || "unknown",
          path: req.originalUrl,
          method: req.method,
          details:
            error.name === "TokenExpiredError"
              ? "Expired JWT supplied"
              : "Invalid JWT supplied",
        });

        return res.status(401).json({
          message: "Your session is invalid or expired. Please sign in again.",
        });
      }
    },
  ];
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
}

module.exports = {
  createSecurityMiddleware,
  authRateLimiter,
  writeSecurityEvent,
  requireRole,
};
