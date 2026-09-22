/* Service worker do Bex Print.
 *
 * Regra de ouro: NUNCA guardar HTML. O app publica várias vezes por semana e
 * um shell antigo em cache mostraria tela velha por dias — foi assim que o
 * painel do Bex Lite ficou exibindo um número já corrigido. Então:
 *
 *   navegação (HTML)      rede primeiro; sem rede, a página offline
 *   /assets/*             cache primeiro — o nome traz o hash, é imutável
 *   resto (Supabase, API) só rede; nada é interceptado
 *
 * O VERSAO abaixo muda a cada alteração deste arquivo: o navegador vê o SW
 * diferente, instala, e o activate apaga os caches antigos.
 */
const VERSAO = "bexprint-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()),
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
            if (resp.ok) {
              const copia = resp.clone();
              caches.open(VERSAO).then((cache) => cache.put(req, copia));
            }
            return resp;
          }),
      ),
    );
  }
});
