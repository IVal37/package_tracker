// A stand-in for the few Supabase Auth endpoints Wayfind calls, for the
// launch test only. It is never part of the app, never deployed, and listens
// on 127.0.0.1 only. Plain Node: http and crypto.
//
//   POST /auth/v1/otp                    "send" a magic link (kept for the test)
//   POST /auth/v1/token?grant_type=pkce  swap the link's code for a session
//   POST /auth/v1/token?grant_type=refresh_token
//   GET  /auth/v1/user                   the user behind a token
//   GET  /auth/v1/.well-known/jwks.json  the public key tokens are signed with
//   POST /auth/v1/logout
//   GET  /__test__/magic-link?email=     test-only: the link that was "emailed"
//   POST /inngest/e/<key>                swallow Inngest events (no cloud calls)
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 54399);
const ISSUER = `http://127.0.0.1:${PORT}/auth/v1`;
const KID = "e2e-key";

// A fresh signing key each run: nothing outlives the test.
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KID,
  alg: "ES256",
  use: "sig",
};

const b64url = (input) => Buffer.from(input).toString("base64url");

function signJwt(claims) {
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const payload = b64url(JSON.stringify(claims));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

const users = new Map(); // email -> user
const codes = new Map(); // auth code -> { email, challenge }
const refreshTokens = new Map(); // refresh token -> email
const links = new Map(); // email -> the latest magic link

function userFor(email) {
  if (!users.has(email)) {
    const now = new Date().toISOString();
    users.set(email, {
      id: randomUUID(),
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: now,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: now,
      updated_at: now,
    });
  }
  return users.get(email);
}

function session(email) {
  const user = userFor(email);
  const now = Math.floor(Date.now() / 1000);
  const refreshToken = randomUUID();
  refreshTokens.set(refreshToken, email);
  return {
    access_token: signJwt({
      iss: ISSUER,
      aud: "authenticated",
      sub: user.id,
      email,
      role: "authenticated",
      aal: "aal1",
      session_id: randomUUID(),
      iat: now,
      exp: now + 3600,
    }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refreshToken,
    user,
  };
}

function emailFromBearer(request) {
  const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? "" : JSON.stringify(body));
}

const authError = (response, status, message) =>
  send(response, status, { code: status, error_code: "e2e", msg: message });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /auth/v1/.well-known/jwks.json") {
    return send(response, 200, { keys: [jwk] });
  }

  if (route === "POST /auth/v1/otp") {
    const body = await readJson(request);
    const email = String(body.email ?? "").toLowerCase();
    if (!email || !body.code_challenge) {
      return authError(response, 400, "email and code_challenge required");
    }
    userFor(email);
    const code = randomUUID();
    codes.set(code, { email, challenge: body.code_challenge });
    const redirectTo = url.searchParams.get("redirect_to") ?? "";
    links.set(email, `${redirectTo}?code=${code}`);
    return send(response, 200, {});
  }

  if (route === "POST /auth/v1/token") {
    const body = await readJson(request);
    const grant = url.searchParams.get("grant_type");
    if (grant === "pkce") {
      const pending = codes.get(body.auth_code);
      codes.delete(body.auth_code);
      const challenge = createHash("sha256")
        .update(String(body.code_verifier ?? ""))
        .digest("base64url");
      if (!pending || pending.challenge !== challenge) {
        return authError(response, 400, "invalid code or verifier");
      }
      return send(response, 200, session(pending.email));
    }
    if (grant === "refresh_token") {
      const email = refreshTokens.get(body.refresh_token);
      if (!email) return authError(response, 400, "invalid refresh token");
      return send(response, 200, session(email));
    }
    return authError(response, 400, "unsupported grant");
  }

  if (route === "GET /auth/v1/user") {
    const email = emailFromBearer(request);
    if (!email || !users.has(email)) return authError(response, 401, "no user");
    return send(response, 200, users.get(email));
  }

  if (route === "POST /auth/v1/logout") {
    response.writeHead(204);
    return response.end();
  }

  if (route === "GET /__test__/magic-link") {
    const link = links.get(
      String(url.searchParams.get("email") ?? "").toLowerCase(),
    );
    return link ? send(response, 200, { url: link }) : send(response, 404, {});
  }

  if (request.method === "POST" && url.pathname.startsWith("/inngest/e/")) {
    await readJson(request);
    return send(response, 200, { ids: [randomUUID()], status: 200 });
  }

  return send(response, 404, { msg: `not faked: ${route}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake auth listening on http://127.0.0.1:${PORT}`);
});
