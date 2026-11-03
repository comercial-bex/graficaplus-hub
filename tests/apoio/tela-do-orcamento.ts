import { readdirSync, readFileSync } from "node:fs";

/**
 * O texto da tela do orçamento da equipe: a rota + as partes que saíram dela (cabeçalho, passos,
 * resumo) em `src/components/orcamento/tela/`. A tela tinha 3.100 linhas num arquivo só; foi
 * dividida sem mudar comportamento, e os testes que leem o código para travar o contrato passam a
 * ler o conjunto, não só o arquivo da rota.
 */
const ROTA = "src/routes/_authenticated/orcamentos.$id.tsx";
const PARTES = "src/components/orcamento/tela";

export function telaDoOrcamento(): string {
  const partes = readdirSync(PARTES)
    .filter((f) => /\.(tsx?|ts)$/.test(f))
    .sort()
    .map((f) => readFileSync(`${PARTES}/${f}`, "utf8"));
  return [readFileSync(ROTA, "utf8"), ...partes].join("\n");
}
