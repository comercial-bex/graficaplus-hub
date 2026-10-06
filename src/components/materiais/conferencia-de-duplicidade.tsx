import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_MOTIVO,
  ROTULO_DO_NIVEL,
  normalizarUnidade,
  type ConferenciaIa,
  type MaterialComparavel,
  type Parecido,
} from "@/domain/materiais/parecidos";

/**
 * O quadro "parecidos já cadastrados" do cadastro de material.
 *
 * A busca por texto roda enquanto a pessoa digita, de graça. A IA só roda no
 * clique de "Conferir com IA" (gasta saldo do Lovable — decisão do dono), e o
 * resultado dela vale só para o que estava escrito na hora: mudou o nome ou
 * as características, o resultado some e a conferência pode ser refeita.
 */
export function ConferenciaDeDuplicidade({
  nome,
  parecidos,
  ia,
  conferindo,
  podeUsarIa,
  onConferirComIa,
  onUsarExistente,
  onUsarNome,
}: {
  nome: string;
  parecidos: Parecido[];
  ia: ConferenciaIa | null;
  conferindo: boolean;
  podeUsarIa: boolean;
  onConferirComIa: () => void;
  onUsarExistente: (material: { nome: string }) => void;
  onUsarNome: (nome: string) => void;
}) {
  if (nome.trim().length < 3) return null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Já existe algo parecido?</p>
        {podeUsarIa && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={conferindo}
            onClick={onConferirComIa}
            title="Usa um pouco do saldo de IA do Lovable"
          >
            {conferindo ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            Conferir com IA
          </Button>
        )}
      </div>

      {parecidos.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" /> Nenhum material com nome parecido.
          {podeUsarIa && " A IA também pega sinônimos (ex.: PS e poliestireno)."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {parecidos.map((p) => (
            <LinhaDeParecido
              key={p.material.id}
              material={p.material}
              selo={ROTULO_DO_NIVEL[p.nivel]}
              forte={p.nivel !== "parecido"}
              detalhe={ROTULO_DO_MOTIVO[p.motivo]}
              onUsar={() => onUsarExistente(p.material)}
            />
          ))}
        </ul>
      )}

      {ia && <ResultadoDaIa ia={ia} onUsarExistente={onUsarExistente} onUsarNome={onUsarNome} />}
    </div>
  );
}

function LinhaDeParecido({
  material,
  selo,
  forte,
  detalhe,
  onUsar,
}: {
  material: Pick<MaterialComparavel, "nome" | "unidade" | "caracteristicas">;
  selo: string;
  forte: boolean;
  detalhe: string;
  onUsar: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={forte ? "destructive" : "outline"}
            className={cn("font-normal", !forte && "text-muted-foreground")}
          >
            {selo}
          </Badge>
          <span className="font-medium">{material.nome}</span>
          {material.unidade && (
            <span className="text-xs text-muted-foreground">· {normalizarUnidade(material.unidade)}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {detalhe}
          {material.caracteristicas ? ` · ${material.caracteristicas}` : ""}
        </p>
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onUsar}>
        É este — não cadastrar
      </Button>
    </li>
  );
}

function ResultadoDaIa({
  ia,
  onUsarExistente,
  onUsarNome,
}: {
  ia: ConferenciaIa;
  onUsarExistente: (material: { nome: string }) => void;
  onUsarNome: (nome: string) => void;
}) {
  if (ia.estado !== "ok") {
    const texto =
      ia.estado === "sem_ia"
        ? "A IA não está ligada neste projeto (falta a chave do Lovable no servidor). A busca por nome continua valendo."
        : ia.estado === "sem_saldo"
          ? "O saldo de IA do Lovable acabou. A busca por nome continua valendo."
          : ia.estado === "limite"
            ? "Muitas conferências seguidas. Espere um minuto e tente de novo."
            : `A conferência com IA falhou: ${ia.detalhe}.`;
    return (
      <p className="flex gap-1.5 text-xs text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {texto}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 border-t pt-2">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5" /> O que a IA achou
      </p>
      {ia.duplicados.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum material cadastrado é o mesmo que este.</p>
      ) : (
        <ul className="space-y-1.5">
          {ia.duplicados.map((d) => (
            <LinhaDeParecido
              key={d.id}
              material={{ nome: d.nome, unidade: null, caracteristicas: null }}
              selo={d.certeza === "alta" ? "Já existe" : "Talvez seja o mesmo"}
              forte={d.certeza === "alta"}
              detalhe={d.motivo}
              onUsar={() => onUsarExistente({ nome: d.nome })}
            />
          ))}
        </ul>
      )}
      {ia.nome_sugerido && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Nome no padrão do cadastro: <strong className="text-foreground">{ia.nome_sugerido}</strong>
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => onUsarNome(ia.nome_sugerido as string)}
          >
            usar este nome
          </Button>
        </p>
      )}
    </div>
  );
}
