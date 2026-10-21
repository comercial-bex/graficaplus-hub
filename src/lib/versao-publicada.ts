/**
 * A aba está rodando a versão publicada? (21/10/2026)
 *
 * A faixa "Nova versão disponível" só aparecia quando o service worker mudava —
 * e o `sw.js` é o mesmo em toda publicação (`bexprint-v2`). Quem deixa o
 * WhatsApp aberto o dia todo seguia no código da manhã depois de cada publicação,
 * sem aviso: às 16:19 a Jhessy abriu dois rascunhos vazios para a mesma conversa
 * (#102 e #103, 29 s de diferença), num dia em que o "Continuar no #N" já estava
 * no ar desde cedo.
 *
 * O HTML publicado carrega um script de entrada com o hash do build
 * (`/assets/index-<hash>.js`), e ele muda a cada publicação: comparar o da aba
 * com o do HTML de agora diz se há versão nova. `/login` é a página pública mais
 * leve (sem sessão, ~13 KB).
 */

const ENTRADA_NO_HTML = /<script\b[^>]*\bsrc="(\/assets\/index-[\w-]+\.js)"/;

/** O script de entrada que um HTML publicado carrega. */
export function entradaDoHtml(html: string): string | null {
  return html.match(ENTRADA_NO_HTML)?.[1] ?? null;
}

/** O script de entrada que esta aba carregou. Nulo no desenvolvimento (sem build). */
export function entradaRodando(doc: Document): string | null {
  return doc.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? null;
}

/**
 * Há publicação mais nova que a desta aba? Na dúvida (rede fora, página sem o
 * script, desenvolvimento) responde que não: a faixa só aparece com certeza.
 */
export async function haVersaoNova(doc: Document = document): Promise<boolean> {
  const atual = entradaRodando(doc);
  if (!atual) return false;
  try {
    const resp = await fetch("/login", { cache: "no-store", credentials: "omit" });
    if (!resp.ok) return false;
    const publicada = entradaDoHtml(await resp.text());
    return !!publicada && publicada !== atual;
  } catch {
    return false;
  }
}
