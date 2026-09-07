/**
 * A decapagem segue o recorte.
 *
 * No recorte de vinil a máquina leva segundos e a pessoa leva minutos: tirar o
 * excesso à mão é o maior custo do serviço. A conta já sabia disso —
 * `tempoRecorte` devolve `minutosMaoDeObra` — mas o número ficava só na
 * memória de cálculo: aparecia escrito e não entrava no preço. Custo visível
 * e não cobrado é o pior tipo de zero disfarçado.
 *
 * Aqui cada linha de processo cobrada por metro linear ganha uma linha de mão
 * de obra que a SEGUE: nasce quando o processo nasce, recalcula quando o
 * traçado ou a complexidade mudam, some quando o processo some.
 *
 *   - hora ajustada à mão nunca é sobrescrita (`ajustada`);
 *   - se o processo some, a linha ajustada fica como linha comum — apagar
 *     trabalho de gente, não;
 *   - a função (quem decapa) só é escolhida sozinha se for inequívoca. Com
 *     duas candidatas a escolha seria arbitrária, e arbitrário em silêncio é
 *     o padrão nº 2 desta base. Sem função a linha nasce a R$ 0 e a tela avisa.
 */

export type FuncaoMO = { id: string; funcao: string; custo_hora: number | null; encargos_pct: number | null };

export type LinhaMOSync = {
  key: string;
  funcao_id: string | null;
  descricao: string;
  horas: string;
  custoHora: string;
  encargosPct: string;
  /** Chave da linha de processo que esta linha segue, quando é decapagem automática. */
  segueProcesso?: string;
  /** Hora mexida à mão: a sincronização não encosta mais nela. */
  ajustada?: boolean;
};

export type ProcessoRecorte = { key: string; descricao: string; base: string; maoDeObraMin: string };

const num = (t: string) => {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Quem decapa: só quando há UMA função com cara de acabamento. */
export function escolherFuncaoDecapagem(funcoes: FuncaoMO[]): FuncaoMO | null {
  const candidatas = funcoes.filter((f) => /decap|acabament|aplica/i.test(f.funcao));
  return candidatas.length === 1 ? candidatas[0] : null;
}

export function sincronizarDecapagem(
  processos: ProcessoRecorte[],
  atual: LinhaMOSync[],
  funcoes: FuncaoMO[],
  novaKey: () => string,
): LinhaMOSync[] {
  const recortes = processos.filter((p) => p.base === "metro_linear" && num(p.maoDeObraMin) > 0);
  const vivos = new Set(recortes.map((p) => p.key));
  let mudou = false;

  // 1. Linhas que seguiam um processo que sumiu: a automática sai; a ajustada
  //    à mão fica, agora como linha comum.
  const linhas: LinhaMOSync[] = [];
  for (const l of atual) {
    if (!l.segueProcesso || vivos.has(l.segueProcesso)) {
      linhas.push(l);
      continue;
    }
    mudou = true;
    if (l.ajustada) linhas.push({ ...l, segueProcesso: undefined });
  }

  // 2. Cada recorte tem a sua: recalcula a automática, cria a que falta.
  const funcao = escolherFuncaoDecapagem(funcoes);
  for (const p of recortes) {
    const horas = (num(p.maoDeObraMin) / 60).toFixed(3);
    const i = linhas.findIndex((l) => l.segueProcesso === p.key);
    if (i >= 0) {
      if (!linhas[i].ajustada && linhas[i].horas !== horas) {
        linhas[i] = { ...linhas[i], horas };
        mudou = true;
      }
      continue;
    }
    mudou = true;
    linhas.push({
      key: novaKey(),
      funcao_id: funcao?.id ?? null,
      descricao: funcao?.funcao ?? `Decapagem e fita — ${p.descricao || "recorte"}`,
      horas,
      custoHora: String(funcao?.custo_hora ?? 0),
      encargosPct: String(Number(funcao?.encargos_pct ?? 0) * 100),
      segueProcesso: p.key,
    });
  }

  // Sem mudança, devolve o MESMO array: estado igual não re-renderiza.
  return mudou ? linhas : atual;
}
