import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicAccessPayload, PublicLinkScope } from "./public-access";

const tokenSchema = z.object({ token: z.string().min(16) });
const publicActionSchema = tokenSchema.extend({
  action: z.enum(["approve_quote", "upload_file", "approve_art", "reject_art", "upload_payment"]),
  notes: z.string().max(1000).optional(),
  fileName: z.string().max(255).optional(),
});

const actionScopes: Record<z.infer<typeof publicActionSchema>["action"], PublicLinkScope> = {
  approve_quote: "quote:approve",
  upload_file: "file:upload",
  approve_art: "art:review",
  reject_art: "art:review",
  upload_payment: "payment:upload",
};

async function getPublicLinkSecret() {
  const { default: process } = await import("node:process");
  return (
    process.env.PUBLIC_LINK_SECRET ??
    process.env.SESSION_SECRET ??
    "bex-print-local-public-link-secret"
  );
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function sign(encodedPayload: string) {
  const { default: crypto } = await import("node:crypto");
  return crypto
    .createHmac("sha256", await getPublicLinkSecret())
    .update(encodedPayload)
    .digest("base64url");
}

async function timingSafeEqual(a: string, b: string) {
  const { default: crypto } = await import("node:crypto");
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function createPublicAccessToken(payload: PublicAccessPayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${await sign(encodedPayload)}`;
}

async function verifyToken(token: string) {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) {
    return { valid: false as const, reason: "Formato do link inválido." };
  }

  const expectedSignature = await sign(encodedPayload);
  if (!(await timingSafeEqual(signature, expectedSignature))) {
    return { valid: false as const, reason: "Assinatura do link inválida." };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as PublicAccessPayload;
    if (!payload.sub || !payload.exp || !Array.isArray(payload.scopes)) {
      return { valid: false as const, reason: "Dados do link incompletos." };
    }

    if (payload.exp * 1000 < Date.now()) {
      return { valid: false as const, reason: "Este link temporário expirou." };
    }

    return { valid: true as const, payload };
  } catch {
    return { valid: false as const, reason: "Não foi possível ler este link." };
  }
}

export const verifyPublicAccessToken = createServerFn({ method: "POST" })
  .inputValidator(tokenSchema)
  .handler(async ({ data }) => verifyToken(data.token));

export const submitPublicPortalAction = createServerFn({ method: "POST" })
  .inputValidator(publicActionSchema)
  .handler(async ({ data }) => {
    const verification = await verifyToken(data.token);
    if (!verification.valid) return { ok: false, message: verification.reason };

    const requiredScope = actionScopes[data.action];
    if (!verification.payload.scopes.includes(requiredScope)) {
      return { ok: false, message: "Este link não permite executar esta ação." };
    }

    return {
      ok: true,
      message: "Recebemos sua solicitação com segurança. A equipe foi notificada.",
      protocol: `PUB-${Date.now().toString(36).toUpperCase()}`,
    };
  });

export const createDemoPublicPortalToken = createServerFn({ method: "POST" }).handler(async () => {
  const { default: crypto } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  return createPublicAccessToken({
    sub: "orc-245",
    type: "quote",
    scopes: [
      "quote:view",
      "quote:approve",
      "file:upload",
      "art:review",
      "payment:upload",
      "order:status",
    ],
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
    nonce: crypto.randomUUID(),
  });
});
