/* Service worker do Bex Print.
 *
 * Regra de ouro: NUNCA guardar HTML. O app publica várias vezes por semana e
 * um shell antigo em cache mostraria tela velha por dias — foi assim que o
 * painel do Bex Lite ficou exibindo um número já corrigido. Então:
 *
 *   navegação (HTML)      rede primeiro; sem rede, a página offline
 *   /assets/*             cache primeiro — o nome traz o hash, é imutável
 *   /icons/*              cache primeiro
 *   resto (Supabase, API) só rede; nada é interceptado
 *
 * O VERSAO abaixo muda a cada alteração deste arquivo: o navegador vê o SW
 * diferente, instala, e o activate apaga os caches antigos.
 *
 * Poda: cada publicação gera chunks com hash novo, e os velhos nunca mais são
 * pedidos. Sem poda o cache cresceria alguns MB por deploy, para sempre. Depois
 * de guardar um asset, ficam só os LIMITE_ASSETS mais recentes (a ordem de
 * cache.keys() é a de inserção).
 */
const VERSAO = "bexprint-v2";
const OFFLINE = "/offline.html";
const LIMITE_ASSETS = 150;

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) =>
        // Um item que falhe (ícone renomeado, por exemplo) não pode impedir o SW
        // de instalar — a página offline é o que importa.
        Promise.all([OFFLINE, "/icons/icon-192.png"].map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function guardarEPodar(req, resp) {
  const cache = await caches.open(VERSAO);
  await cache.put(req, resp);
  const chaves = await cache.keys();
  const assets = chaves.filter((r) => new URL(r.url).pathname.startsWith("/assets/"));
  const sobra = assets.length - LIMITE_ASSETS;
  if (sobra > 0) await Promise.all(assets.slice(0, sobra).map((r) => cache.delete(r)));
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fontes: nada de cache

  if (req.mode === "navigate") {
    evento.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    evento.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((resp) => {
            if (resp.ok) evento.waitUntil(guardarEPodar(req, resp.clone()).catch(() => undefined));
            return resp;
          }),
      ),
    );
  }
});
