import { ExternalLink } from "lucide-react";
import { StatusChip } from "@/components/bex/StatusChip";
import { rotuloDoRamo } from "@/domain/parceiros/ramo";

export type RamoDoParceiro = {
  id: string;
  ramo_atuacao: string | null;
  ramo_outro: string | null;
  comprovacao_url: string | null;
  validado_em: string | null;
};

/** Ramo e comprovação informados no convite. Validar é só controle interno: não trava o painel. */
export function RamoDoParceiroLinha({
  dados,
  podeValidar,
}: {
  dados?: RamoDoParceiro;
  podeValidar: boolean;
}) {
  if (!dados) return null;
  const ramo = rotuloDoRamo(dados.ramo_atuacao, dados.ramo_outro);
  const link =
    dados.comprovacao_url && /^https?:\/\//i.test(dados.comprovacao_url)
      ? dados.comprovacao_url
      : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {dados.validado_em ? (
        <StatusChip label="Validado" tone="lime" />
      ) : (
        <StatusChip label="A validar" tone="amber" />
      )}
      <span className="text-muted-foreground">
        Ramo: <span className="text-foreground">{ramo ?? "não informado"}</span>
      </span>
      {dados.comprovacao_url &&
        (link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[color:var(--bex-cyan)] hover:underline"
          >
            {dados.comprovacao_url.replace(/^https?:\/\//i, "")}{" "}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-foreground">{dados.comprovacao_url}</span>
        ))}
    </div>
  );
}
