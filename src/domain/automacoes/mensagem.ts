/**
 * A mensagem da automação, do jeito que o DESPACHANTE vai montar.
 *
 * Desde 06/10/2026 quem troca {{os.numero}} pelo número na hora de mandar é
 * `textoDaAutomacao` (domain/automacoes/destino.ts), que chama ESTA função —
 * a tela e o envio usam o mesmo código. Antes a troca ficava em
 * supabase/functions/process-automations/index.ts, que ninguém chamava. A
 * regra continua: caminho desconhecido vira texto vazio, calado — por isso a
 * tela recusa variável que não existe antes de salvar.
 */

/** A expressão das variáveis: {{os.numero}}, {{cliente.nome}}. */
export const PADRAO_VARIAVEL = /{{\s*([\w.]+)\s*}}/g;

type Dados = Record<string, unknown>;

/** Segue os pontos do caminho; o que faltar vira undefined. */
function valorNoCaminho(fonte: unknown, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, chave) => {
    if (acc && typeof acc === "object" && chave in (acc as Dados)) {
      return (acc as Dados)[chave];
    }
    return undefined;
  }, fonte);
}

/** null e undefined viram texto vazio. */
export function renderizarMensagem(modelo: string, dados: Dados): string {
  return modelo.replace(new RegExp(PADRAO_VARIAVEL.source, "g"), (_, caminho: string) => {
    const valor = valorNoCaminho(dados, caminho);
    if (valor === undefined || valor === null) return "";
    return String(valor);
  });
}

/** As variáveis que o texto usa, sem repetir, na ordem em que aparecem. */
export function variaveisUsadas(modelo: string): string[] {
  const vistas: string[] = [];
  for (const m of modelo.matchAll(new RegExp(PADRAO_VARIAVEL.source, "g"))) {
    if (!vistas.includes(m[1])) vistas.push(m[1]);
  }
  return vistas;
}

/** As que o evento não tem — e que sairiam em branco na mensagem. */
export function variaveisDesconhecidas(modelo: string, permitidas: string[]): string[] {
  return variaveisUsadas(modelo).filter((v) => !permitidas.includes(v));
}

/**
 * Monta o objeto de exemplo a partir das chaves com ponto:
 * [{chave: "os.numero", exemplo: "49"}] → { os: { numero: "49" } }.
 */
export function dadosDeExemplo(variaveis: { chave: string; exemplo: string }[]): Dados {
  const raiz: Dados = {};
  for (const v of variaveis) {
    const partes = v.chave.split(".");
    let no = raiz;
    partes.forEach((parte, i) => {
      if (i === partes.length - 1) {
        no[parte] = v.exemplo;
      } else {
        if (!no[parte] || typeof no[parte] !== "object") no[parte] = {};
        no = no[parte] as Dados;
      }
    });
  }
  return raiz;
}
