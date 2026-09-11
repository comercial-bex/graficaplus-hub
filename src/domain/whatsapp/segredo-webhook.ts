/**
 * O segredo que prova que quem chama o webhook é o Z-API.
 *
 * O receptor antigo conferia um segredo só SE a variável de ambiente existisse
 * (`if (expected && secret !== expected)`): sem a variável, qualquer um passava.
 * Porta que abre quando a fechadura falta não é porta.
 *
 * Aqui é o contrário: instância sem hash cadastrado RECUSA tudo. O segredo é
 * sorteado no navegador de quem configura, aparece uma vez para colar no
 * painel do Z-API, e só o SHA-256 dele vai para o banco. Quem lê o banco não
 * consegue montar a URL.
 *
 * Usa Web Crypto, que existe tanto no navegador quanto no servidor
 * (Cloudflare Workers e Node) — a mesma função sorteia de um lado e confere do
 * outro.
 */

function paraHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 bytes aleatórios em base64url — cabe numa URL sem escapar nada. */
export function gerarSegredo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 em hex minúsculo — o formato que o banco exige (64 caracteres). */
export async function hashDoSegredo(segredo: string): Promise<string> {
  const dados = new TextEncoder().encode(segredo);
  return paraHex(await crypto.subtle.digest("SHA-256", dados));
}

/**
 * Compara dois hashes sem sair no primeiro caractere diferente. Comparação
 * comum responde mais rápido quanto mais cedo erra, e essa diferença de tempo
 * deixa adivinhar o valor caractere a caractere.
 */
export function hashesIguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export const CAMINHO_WEBHOOK = "/api/whatsapp/webhook";

/** A URL completa para colar no painel do Z-API. */
export function urlDoWebhook(origem: string, segredo: string): string {
  return `${origem.replace(/\/+$/, "")}${CAMINHO_WEBHOOK}?token=${encodeURIComponent(segredo)}`;
}
