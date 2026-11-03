import type { Dispatch, SetStateAction } from "react";
import type { Permission } from "@/lib/permissions";
import { ROTULO_DO_STATUS, statusTone } from "./comum";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { StatusChip } from "@/components/bex/StatusChip";
import { dicaCampo, dicaTela } from "@/lib/dicas";

export function CabecalhoIdentificacao({
  convertendo,
  descontoPendente,
  fechado,
  hasPermission,
  linhaDaTaxa,
  orc,
  podeConverter,
  setConferindo,
}: {
  convertendo: boolean;
  descontoPendente: boolean;
  fechado: boolean;
  hasPermission: (permission: Permission) => boolean;
  linhaDaTaxa: any;
  orc: any;
  podeConverter: boolean;
  setConferindo: Dispatch<SetStateAction<"aprovado" | "enviado" | null>>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <Dica texto="Voltar para orçamentos">
          <Button asChild variant="ghost" size="icon" className="mt-1 shrink-0">
            <Link to="/orcamentos" aria-label="Voltar para orçamentos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        </Dica>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <span>Orçamento #{orc.numero}</span>
            <StatusChip label={ROTULO_DO_STATUS[orc.status] ?? orc.status} tone={statusTone[orc.status] ?? "muted"} />
            {linhaDaTaxa && <StatusChip label="Expresso" tone="amber" />}
          </div>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{orc.titulo}</h1>
            <DicaIcone texto={dicaTela("/orcamentos")} rotulo="Orçamento" lado="bottom" className="h-5 w-5" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {orc.cliente_nome ? (
              <>Cliente: <span className="text-foreground font-medium">{orc.cliente_nome}</span></>
            ) : (
              "Sem cliente vinculado"
            )}
          </p>
        </div>
      </div>
    
      {/* Converter exige `orcamentos.convert`, que só admin e gestor têm.
          Sem a permissão, no lugar do botão fica a explicação de quem
          converte e por onde essa pessoa é avisada. */}
      {/* Só aprovado vira OS: em rascunho, enviado, rejeitado ou expirado o
          banco recusa ("Orçamento sem versão aprovada") — o botão não
          promete o que não entrega. Com OS, o lugar dele leva até ela. */}
      {orc.os_id && (
        <Button asChild variant="outline" className="shrink-0 h-11 md:h-10">
          <Link to="/os/$id" params={{ id: orc.os_id }}>
            Ver a OS <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      )}
      {!fechado && orc.status === "enviado" && podeConverter && hasPermission("orcamentos.approve") && (
        <Dica texto="Use quando o cliente já confirmou por WhatsApp ou no balcão. Registra a aprovação da equipe no histórico e cria a OS.">
          <Button
            onClick={() => setConferindo("enviado")}
            disabled={descontoPendente || convertendo}
            className="shrink-0 h-11 md:h-10"
          >
            {convertendo ? "Criando a OS..." : "Cliente aprovou: converter em OS"} <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </Dica>
      )}
      {!fechado && orc.status === "aprovado" && (
        podeConverter ? (
          // Desconto que passou da alçada sem aprovação: o banco recusa a
          // conversão (converter_orcamento_em_os), então o botão já trava
          // aqui com o motivo.
          <Dica texto={descontoPendente ? dicaCampo("/orcamentos", "desconto_pendente") : null}>
            <Button
              onClick={() => setConferindo("aprovado")}
              disabled={descontoPendente || convertendo}
              className="shrink-0 h-11 md:h-10"
            >
              {descontoPendente ? <Lock className="h-4 w-4 mr-1" /> : null}
              {convertendo ? "Criando a OS..." : "Converter em OS"} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Dica>
        ) : (
          <div className="shrink-0 max-w-xs rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Lock className="h-3.5 w-3.5" /> Converter em OS é do gerente ou do admin
            </p>
            <p className="mt-1">
              {orc.status === "aprovado" ? (
                <>
                  Este orçamento já está aprovado, então já aparece na lista de pendências
                  deles no{" "}
                  <Link to="/dashboard" className="underline underline-offset-2">
                    painel
                  </Link>
                  .
                </>
              ) : (
                <>
                  Marque o status como <strong>aprovado</strong> assim que o cliente fechar: é
                  isso que coloca o orçamento na lista de pendências deles no{" "}
                  <Link to="/dashboard" className="underline underline-offset-2">
                    painel
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        )
      )}
    </div>
  );
}
