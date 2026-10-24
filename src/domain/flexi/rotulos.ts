import type { Candidato } from "./vinculo";

/** O vínculo de um job como a tela o lê do banco (`rip_job_vinculos`). */
export type VinculoDoJob = {
  estado: "sugerido" | "revisar" | "confirmado" | "recusado" | "sem_orcamento";
  origem: "numero_no_nome" | "medida" | "manual" | null;
  orcamento_numero: number | null;
  orcamento_titulo: string | null;
  item_descricao: string | null;
  confianca: number | null;
  motivos: string[];
  candidatos: Candidato[];
  motivo_sem_orcamento: "prova" | "teste" | "terceirizado" | "outro" | null;
};

export type JobParaConferir = {
  id: string;
  nome_job: string;
  largura_cm: number | string;
  altura_cm: number | string;
  copias: number;
  impresso_em: string;
  vinculo: VinculoDoJob | null;
};

export const MOTIVO_ROTULO = {
  prova: "Prova",
  teste: "Teste",
  terceirizado: "Terceirizado",
  outro: "Outro",
} as const;

export const STATUS_DO_ORCAMENTO: Record<string, string> = {
  rascunho: "rascunho",
  enviado: "enviado",
  aprovado: "aprovado",
  rejeitado: "rejeitado",
  expirado: "expirado",
  convertido: "com OS",
};

/** O que a coluna "Orçamento" mostra para cada situação do vínculo. */
export function rotuloDoVinculo(v: VinculoDoJob | null): {
  texto: string;
  tom: "ok" | "atencao" | "neutro";
} {
  if (!v) return { texto: "Sem orçamento ligado", tom: "neutro" };
  switch (v.estado) {
    case "confirmado":
      return { texto: `Orç. ${v.orcamento_numero} ✓`, tom: "ok" };
    case "sugerido":
      return { texto: `Orç. ${v.orcamento_numero}? (sugerido)`, tom: "atencao" };
    case "revisar":
      return { texto: `Escolher entre ${v.candidatos.length}`, tom: "atencao" };
    case "sem_orcamento":
      return {
        texto: `Sem orçamento (${MOTIVO_ROTULO[v.motivo_sem_orcamento ?? "outro"].toLowerCase()})`,
        tom: "neutro",
      };
    case "recusado":
      return { texto: "Sugestão recusada", tom: "neutro" };
  }
}
